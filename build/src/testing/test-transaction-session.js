// @ts-check
import SharedTransactionBroker from "./shared-transaction-broker.js";
import { runWithSharedTransactionBrokerConfig, sharedTransactionBrokerContextMatches } from "./shared-transaction-proxy-driver.js";
/** @typedef {{connection: import("../database/drivers/base.js").default, databaseIdentifier: string, release: () => Promise<void>, reuseKey: string}} Enrollment */
/**
 * Backend-owned, capability-scoped transaction set for long-lived test services.
 * Join coordinates are intentionally obtainable only as a live control message.
 */
export default class TestTransactionSession {
    /**
     * Creates an unstarted transaction session.
     * @param {import("../configuration.js").default} [configuration] - Backend configuration owning enrolled pools.
     */
    constructor(configuration) {
        this.configuration = configuration;
        /** @type {SharedTransactionBroker | undefined} */
        this.broker = undefined;
        /** @type {Map<string, Enrollment>} */
        this.enrollments = new Map();
        /** @type {Map<string, {pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}>} */
        this.sharedConnectionRegistrations = new Map();
        /** @type {Promise<void> | undefined} */
        this.cleanupPromise = undefined;
        /** @type {Promise<void> | undefined} */
        this.rollbackPromise = undefined;
    }
    /**
     * Begins a test transaction session.
     * @param {{configuration?: import("../configuration.js").default}} [args] - Backend owner.
     * @returns {Promise<TestTransactionSession>} - Begun session.
     */
    static async begin({ configuration } = {}) {
        const session = new TestTransactionSession(configuration);
        session.broker = await SharedTransactionBroker.start({ connections: {} });
        return session;
    }
    /**
     * Joins one request/job callback from a live backend control message.
     * @template T
     * @param {{address: string, capability: string}} message - Ephemeral coordinates received over live IPC.
     * @param {() => T} callback - Backend request or worker work.
     * @returns {T} - Callback result.
     */
    static join(message, callback) {
        return runWithSharedTransactionBrokerConfig({ ...message, allowDynamicIdentities: true, databaseIdentifiers: [], expected: true }, callback);
    }
    /**
     * Lazily adds an exact physical connection to the common rollback set.
     * @param {Enrollment} enrollment - Checked-out physical connection and owner release hook.
     */
    async enroll(enrollment) {
        const broker = this.requiredBroker();
        const identity = `${enrollment.databaseIdentifier}\0${enrollment.reuseKey}`;
        const existing = this.enrollments.get(identity);
        if (existing) {
            if (existing.connection !== enrollment.connection)
                await enrollment.release();
            return;
        }
        try {
            await enrollment.connection.startTransaction();
        }
        catch (error) {
            /** @type {Error | undefined} */
            let releaseFailure;
            try {
                await enrollment.release();
            }
            catch (releaseError) {
                releaseFailure = this.normalizeError(releaseError);
            }
            if (releaseFailure) {
                throw new AggregateError([this.normalizeError(error), releaseFailure], "Test transaction enrollment start and release failed", { cause: error });
            }
            throw error;
        }
        try {
            broker.enrollConnection(enrollment);
            this.enrollments.set(identity, enrollment);
        }
        catch (error) {
            await this.rollbackAndRelease(enrollment);
            throw error;
        }
    }
    /**
     * Lazily checks out and enrolls the physical database selected by a tenant descriptor.
     * @param {{databaseIdentifier: string, tenant?: object}} args - Logical and tenant identity.
     */
    async enrollDatabase({ databaseIdentifier, tenant }) {
        if (!this.configuration)
            throw new Error("Test transaction session requires a configuration to enroll a database");
        const pool = this.configuration.getDatabasePool(databaseIdentifier);
        const databaseConfiguration = this.configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant);
        const reuseKey = pool.getConfigurationReuseKey(databaseConfiguration);
        const identity = `${databaseIdentifier}\0${reuseKey}`;
        if (this.enrollments.has(identity))
            return;
        const connection = await this.configuration.runWithTenant(tenant, async () => {
            return await pool.checkout({ name: "Test transaction session" });
        });
        await this.enroll({
            connection,
            databaseIdentifier,
            release: async () => { await pool.checkin(connection); },
            reuseKey
        });
        this.installSharedConnectionProvider(databaseIdentifier, pool);
    }
    /**
     * Makes in-process request/Scoundrel checkouts resolve by current physical identity.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @param {import("../database/pool/base.js").default} pool - Owning pool.
     */
    installSharedConnectionProvider(databaseIdentifier, pool) {
        if (this.sharedConnectionRegistrations.has(databaseIdentifier))
            return;
        const broker = this.requiredBroker();
        const sessionIdentity = { address: broker.address(), capability: broker.capability() };
        const registration = pool.registerTestSharedConnectionProvider({
            matches: () => sharedTransactionBrokerContextMatches(sessionIdentity),
            provider: () => {
                if (!broker.accepting)
                    throw new Error("Test transaction session capability has been revoked");
                const reuseKey = pool.getConfigurationReuseKey();
                const connection = this.enrollments.get(`${databaseIdentifier}\0${reuseKey}`)?.connection;
                if (!connection)
                    throw new Error(`Test transaction physical identity is not enrolled: ${databaseIdentifier}`);
                return connection;
            }
        });
        if (registration)
            this.sharedConnectionRegistrations.set(databaseIdentifier, { pool, registration });
    }
    /**
     * Returns ephemeral coordinates for one live IPC/control message.
     * @returns {{address: string, capability: string}} - Non-durable join coordinates.
     */
    joinMessage() {
        const broker = this.requiredBroker();
        if (!broker.accepting)
            throw new Error("Test transaction session capability has been revoked");
        return { address: broker.address(), capability: broker.capability() };
    }
    /** Stops admission to the capability. */
    revoke() { this.requiredBroker().revoke(); }
    /** Drains work accepted before revocation. */
    async drain() { await this.requiredBroker().drain(); }
    /**
     * Rolls back and releases the complete enrolled set after admission stops.
     * @returns {Promise<void>} - Resolves after rollback and release.
     */
    async rollback() {
        if (this.rollbackPromise)
            return await this.rollbackPromise;
        this.rollbackPromise = this.rollbackActual();
        return await this.rollbackPromise;
    }
    /**
     * Performs rollback and release once.
     * @returns {Promise<void>} - Resolves after actual rollback and release.
     */
    async rollbackActual() {
        const broker = this.requiredBroker();
        if (broker.accepting)
            throw new Error("Test transaction session must be revoked before rollback");
        /** @type {Array<Error>} */
        const errors = [];
        try {
            await broker.close();
        }
        catch (error) {
            errors.push(this.normalizeError(error));
        }
        for (const { pool, registration } of this.sharedConnectionRegistrations.values()) {
            pool.clearTestSharedConnection(registration);
        }
        this.sharedConnectionRegistrations.clear();
        for (const enrollment of this.enrollments.values()) {
            try {
                await this.rollbackAndRelease(enrollment);
            }
            catch (error) {
                errors.push(this.normalizeError(error));
            }
        }
        this.enrollments.clear();
        if (errors.length > 0)
            throw new AggregateError(errors, "Test transaction session rollback failed");
    }
    /**
     * Revokes, drains, rolls back, and releases every enrolled physical connection exactly once.
     * @returns {Promise<void>} - Resolves after idempotent cleanup.
     */
    async cleanup() {
        if (this.cleanupPromise)
            return await this.cleanupPromise;
        this.cleanupPromise = this.cleanupActual();
        return await this.cleanupPromise;
    }
    /**
     * Performs idempotent cleanup once.
     * @returns {Promise<void>} - Resolves after actual cleanup.
     */
    async cleanupActual() {
        this.revoke();
        await this.rollback();
    }
    /**
     * Returns capability-free session diagnostics.
     * @returns {{accepting: boolean, enrollmentCount: number}} - Capability-free diagnostics.
     */
    debugSnapshot() {
        return { accepting: this.broker?.accepting === true, enrollmentCount: this.enrollments.size };
    }
    /**
     * Returns the begun broker.
     * @returns {SharedTransactionBroker} - Begun broker.
     */
    requiredBroker() {
        if (!this.broker)
            throw new Error("Test transaction session has not begun");
        return this.broker;
    }
    /**
     * Rolls back and releases one owned physical connection.
     * @param {Enrollment} enrollment - Owned physical connection.
     * @returns {Promise<void>} - Resolves after rollback and release.
     */
    async rollbackAndRelease(enrollment) {
        /** @type {Array<Error>} */
        const errors = [];
        try {
            await enrollment.connection.rollbackTransaction();
        }
        catch (error) {
            errors.push(this.normalizeError(error));
        }
        try {
            await enrollment.release();
        }
        catch (error) {
            errors.push(this.normalizeError(error));
        }
        if (errors.length > 0)
            throw new AggregateError(errors, "Test transaction enrollment cleanup failed");
    }
    /**
     * Normalizes a thrown cleanup value.
     * @param {unknown} error - Opaque thrown cleanup value narrowed at this boundary.
     * @returns {Error} - Error instance.
     */
    normalizeError(error) { return error instanceof Error ? error : new Error(String(error)); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC10cmFuc2FjdGlvbi1zZXNzaW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvdGVzdC10cmFuc2FjdGlvbi1zZXNzaW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSxvQ0FBb0MsRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBRWxJLG9LQUFvSztBQUVwSzs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHNCQUFzQjtJQUN6Qzs7O09BR0c7SUFDSCxZQUFZLGFBQWE7UUFDdkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsa0RBQWtEO1FBQ2xELElBQUksQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFBO1FBQ3ZCLHNDQUFzQztRQUN0QyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDNUIsaUtBQWlLO1FBQ2pLLElBQUksQ0FBQyw2QkFBNkIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQzlDLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQTtRQUMvQix3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFDLGFBQWEsRUFBQyxHQUFHLEVBQUU7UUFDckMsTUFBTSxPQUFPLEdBQUcsSUFBSSxzQkFBc0IsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUN6RCxPQUFPLENBQUMsTUFBTSxHQUFHLE1BQU0sdUJBQXVCLENBQUMsS0FBSyxDQUFDLEVBQUMsV0FBVyxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDdkUsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztJ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QUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQUMsQ0FBQztRQUM1RixJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxjQUFjLENBQUMsTUFBTSxFQUFFLDRDQUE0QyxDQUFDLENBQUE7SUFDdkcsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxjQUFjLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7Q0FDM0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1icm9rZXIuanNcIlxuaW1wb3J0IHsgcnVuV2l0aFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbnRleHRNYXRjaGVzIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgcmVsZWFzZTogKCkgPT4gUHJvbWlzZTx2b2lkPiwgcmV1c2VLZXk6IHN0cmluZ319IEVucm9sbG1lbnQgKi9cblxuLyoqXG4gKiBCYWNrZW5kLW93bmVkLCBjYXBhYmlsaXR5LXNjb3BlZCB0cmFuc2FjdGlvbiBzZXQgZm9yIGxvbmctbGl2ZWQgdGVzdCBzZXJ2aWNlcy5cbiAqIEpvaW4gY29vcmRpbmF0ZXMgYXJlIGludGVudGlvbmFsbHkgb2J0YWluYWJsZSBvbmx5IGFzIGEgbGl2ZSBjb250cm9sIG1lc3NhZ2UuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RUcmFuc2FjdGlvblNlc3Npb24ge1xuICAvKipcbiAgICogQ3JlYXRlcyBhbiB1bnN0YXJ0ZWQgdHJhbnNhY3Rpb24gc2Vzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIEJhY2tlbmQgY29uZmlndXJhdGlvbiBvd25pbmcgZW5yb2xsZWQgcG9vbHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihjb25maWd1cmF0aW9uKSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIC8qKiBAdHlwZSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5icm9rZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEVucm9sbG1lbnQ+fSAqL1xuICAgIHRoaXMuZW5yb2xsbWVudHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHtwb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259Pn0gKi9cbiAgICB0aGlzLnNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5yb2xsYmFja1Byb21pc2UgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCZWdpbnMgYSB0ZXN0IHRyYW5zYWN0aW9uIHNlc3Npb24uXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb24/OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBbYXJnc10gLSBCYWNrZW5kIG93bmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUZXN0VHJhbnNhY3Rpb25TZXNzaW9uPn0gLSBCZWd1biBzZXNzaW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGJlZ2luKHtjb25maWd1cmF0aW9ufSA9IHt9KSB7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IG5ldyBUZXN0VHJhbnNhY3Rpb25TZXNzaW9uKGNvbmZpZ3VyYXRpb24pXG4gICAgc2Vzc2lvbi5icm9rZXIgPSBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnM6IHt9fSlcbiAgICByZXR1cm4gc2Vzc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIEpvaW5zIG9uZSByZXF1ZXN0L2pvYiBjYWxsYmFjayBmcm9tIGEgbGl2ZSBiYWNrZW5kIGNvbnRyb2wgbWVzc2FnZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7YWRkcmVzczogc3RyaW5nLCBjYXBhYmlsaXR5OiBzdHJpbmd9fSBtZXNzYWdlIC0gRXBoZW1lcmFsIGNvb3JkaW5hdGVzIHJlY2VpdmVkIG92ZXIgbGl2ZSBJUEMuXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBCYWNrZW5kIHJlcXVlc3Qgb3Igd29ya2VyIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBqb2luKG1lc3NhZ2UsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyh7Li4ubWVzc2FnZSwgYWxsb3dEeW5hbWljSWRlbnRpdGllczogdHJ1ZSwgZGF0YWJhc2VJZGVudGlmaWVyczogW10sIGV4cGVjdGVkOiB0cnVlfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogTGF6aWx5IGFkZHMgYW4gZXhhY3QgcGh5c2ljYWwgY29ubmVjdGlvbiB0byB0aGUgY29tbW9uIHJvbGxiYWNrIHNldC5cbiAgICogQHBhcmFtIHtFbnJvbGxtZW50fSBlbnJvbGxtZW50IC0gQ2hlY2tlZC1vdXQgcGh5c2ljYWwgY29ubmVjdGlvbiBhbmQgb3duZXIgcmVsZWFzZSBob29rLlxuICAgKi9cbiAgYXN5bmMgZW5yb2xsKGVucm9sbG1lbnQpIHtcbiAgICBjb25zdCBicm9rZXIgPSB0aGlzLnJlcXVpcmVkQnJva2VyKClcbiAgICBjb25zdCBpZGVudGl0eSA9IGAke2Vucm9sbG1lbnQuZGF0YWJhc2VJZGVudGlmaWVyfVxcMCR7ZW5yb2xsbWVudC5yZXVzZUtleX1gXG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmVucm9sbG1lbnRzLmdldChpZGVudGl0eSlcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIGlmIChleGlzdGluZy5jb25uZWN0aW9uICE9PSBlbnJvbGxtZW50LmNvbm5lY3Rpb24pIGF3YWl0IGVucm9sbG1lbnQucmVsZWFzZSgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGVucm9sbG1lbnQuY29ubmVjdGlvbi5zdGFydFRyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLyoqIEB0eXBlIHtFcnJvciB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIGxldCByZWxlYXNlRmFpbHVyZVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZW5yb2xsbWVudC5yZWxlYXNlKClcbiAgICAgIH0gY2F0Y2ggKHJlbGVhc2VFcnJvcikge1xuICAgICAgICByZWxlYXNlRmFpbHVyZSA9IHRoaXMubm9ybWFsaXplRXJyb3IocmVsZWFzZUVycm9yKVxuICAgICAgfVxuICAgICAgaWYgKHJlbGVhc2VGYWlsdXJlKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbdGhpcy5ub3JtYWxpemVFcnJvcihlcnJvciksIHJlbGVhc2VGYWlsdXJlXSxcbiAgICAgICAgICBcIlRlc3QgdHJhbnNhY3Rpb24gZW5yb2xsbWVudCBzdGFydCBhbmQgcmVsZWFzZSBmYWlsZWRcIixcbiAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICApXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgICB0cnkge1xuICAgICAgYnJva2VyLmVucm9sbENvbm5lY3Rpb24oZW5yb2xsbWVudClcbiAgICAgIHRoaXMuZW5yb2xsbWVudHMuc2V0KGlkZW50aXR5LCBlbnJvbGxtZW50KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrQW5kUmVsZWFzZShlbnJvbGxtZW50KVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTGF6aWx5IGNoZWNrcyBvdXQgYW5kIGVucm9sbHMgdGhlIHBoeXNpY2FsIGRhdGFiYXNlIHNlbGVjdGVkIGJ5IGEgdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ/OiBvYmplY3R9fSBhcmdzIC0gTG9naWNhbCBhbmQgdGVuYW50IGlkZW50aXR5LlxuICAgKi9cbiAgYXN5bmMgZW5yb2xsRGF0YWJhc2Uoe2RhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50fSkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0IHRyYW5zYWN0aW9uIHNlc3Npb24gcmVxdWlyZXMgYSBjb25maWd1cmF0aW9uIHRvIGVucm9sbCBhIGRhdGFiYXNlXCIpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgIGNvbnN0IHJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gYCR7ZGF0YWJhc2VJZGVudGlmaWVyfVxcMCR7cmV1c2VLZXl9YFxuICAgIGlmICh0aGlzLmVucm9sbG1lbnRzLmhhcyhpZGVudGl0eSkpIHJldHVyblxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBwb29sLmNoZWNrb3V0KHtuYW1lOiBcIlRlc3QgdHJhbnNhY3Rpb24gc2Vzc2lvblwifSlcbiAgICB9KVxuICAgIGF3YWl0IHRoaXMuZW5yb2xsKHtcbiAgICAgIGNvbm5lY3Rpb24sXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICByZWxlYXNlOiBhc3luYyAoKSA9PiB7IGF3YWl0IHBvb2wuY2hlY2tpbihjb25uZWN0aW9uKSB9LFxuICAgICAgcmV1c2VLZXlcbiAgICB9KVxuICAgIHRoaXMuaW5zdGFsbFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcihkYXRhYmFzZUlkZW50aWZpZXIsIHBvb2wpXG4gIH1cblxuICAvKipcbiAgICogTWFrZXMgaW4tcHJvY2VzcyByZXF1ZXN0L1Njb3VuZHJlbCBjaGVja291dHMgcmVzb2x2ZSBieSBjdXJyZW50IHBoeXNpY2FsIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gTG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSBwb29sIC0gT3duaW5nIHBvb2wuXG4gICAqL1xuICBpbnN0YWxsU2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKGRhdGFiYXNlSWRlbnRpZmllciwgcG9vbCkge1xuICAgIGlmICh0aGlzLnNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zLmhhcyhkYXRhYmFzZUlkZW50aWZpZXIpKSByZXR1cm5cbiAgICBjb25zdCBicm9rZXIgPSB0aGlzLnJlcXVpcmVkQnJva2VyKClcbiAgICBjb25zdCBzZXNzaW9uSWRlbnRpdHkgPSB7YWRkcmVzczogYnJva2VyLmFkZHJlc3MoKSwgY2FwYWJpbGl0eTogYnJva2VyLmNhcGFiaWxpdHkoKX1cbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSBwb29sLnJlZ2lzdGVyVGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcih7XG4gICAgICBtYXRjaGVzOiAoKSA9PiBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbnRleHRNYXRjaGVzKHNlc3Npb25JZGVudGl0eSksXG4gICAgICBwcm92aWRlcjogKCkgPT4ge1xuICAgICAgICBpZiAoIWJyb2tlci5hY2NlcHRpbmcpIHRocm93IG5ldyBFcnJvcihcIlRlc3QgdHJhbnNhY3Rpb24gc2Vzc2lvbiBjYXBhYmlsaXR5IGhhcyBiZWVuIHJldm9rZWRcIilcbiAgICAgICAgY29uc3QgcmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleSgpXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmVucm9sbG1lbnRzLmdldChgJHtkYXRhYmFzZUlkZW50aWZpZXJ9XFwwJHtyZXVzZUtleX1gKT8uY29ubmVjdGlvblxuICAgICAgICBpZiAoIWNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihgVGVzdCB0cmFuc2FjdGlvbiBwaHlzaWNhbCBpZGVudGl0eSBpcyBub3QgZW5yb2xsZWQ6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAocmVnaXN0cmF0aW9uKSB0aGlzLnNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb25zLnNldChkYXRhYmFzZUlkZW50aWZpZXIsIHtwb29sLCByZWdpc3RyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgZXBoZW1lcmFsIGNvb3JkaW5hdGVzIGZvciBvbmUgbGl2ZSBJUEMvY29udHJvbCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7e2FkZHJlc3M6IHN0cmluZywgY2FwYWJpbGl0eTogc3RyaW5nfX0gLSBOb24tZHVyYWJsZSBqb2luIGNvb3JkaW5hdGVzLlxuICAgKi9cbiAgam9pbk1lc3NhZ2UoKSB7XG4gICAgY29uc3QgYnJva2VyID0gdGhpcy5yZXF1aXJlZEJyb2tlcigpXG4gICAgaWYgKCFicm9rZXIuYWNjZXB0aW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0IHRyYW5zYWN0aW9uIHNlc3Npb24gY2FwYWJpbGl0eSBoYXMgYmVlbiByZXZva2VkXCIpXG4gICAgcmV0dXJuIHthZGRyZXNzOiBicm9rZXIuYWRkcmVzcygpLCBjYXBhYmlsaXR5OiBicm9rZXIuY2FwYWJpbGl0eSgpfVxuICB9XG5cbiAgLyoqIFN0b3BzIGFkbWlzc2lvbiB0byB0aGUgY2FwYWJpbGl0eS4gKi9cbiAgcmV2b2tlKCkgeyB0aGlzLnJlcXVpcmVkQnJva2VyKCkucmV2b2tlKCkgfVxuXG4gIC8qKiBEcmFpbnMgd29yayBhY2NlcHRlZCBiZWZvcmUgcmV2b2NhdGlvbi4gKi9cbiAgYXN5bmMgZHJhaW4oKSB7IGF3YWl0IHRoaXMucmVxdWlyZWRCcm9rZXIoKS5kcmFpbigpIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBhbmQgcmVsZWFzZXMgdGhlIGNvbXBsZXRlIGVucm9sbGVkIHNldCBhZnRlciBhZG1pc3Npb24gc3RvcHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJvbGxiYWNrIGFuZCByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2soKSB7XG4gICAgaWYgKHRoaXMucm9sbGJhY2tQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5yb2xsYmFja1Byb21pc2VcbiAgICB0aGlzLnJvbGxiYWNrUHJvbWlzZSA9IHRoaXMucm9sbGJhY2tBY3R1YWwoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJvbGxiYWNrUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm1zIHJvbGxiYWNrIGFuZCByZWxlYXNlIG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFjdHVhbCByb2xsYmFjayBhbmQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQWN0dWFsKCkge1xuICAgIGNvbnN0IGJyb2tlciA9IHRoaXMucmVxdWlyZWRCcm9rZXIoKVxuICAgIGlmIChicm9rZXIuYWNjZXB0aW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0IHRyYW5zYWN0aW9uIHNlc3Npb24gbXVzdCBiZSByZXZva2VkIGJlZm9yZSByb2xsYmFja1wiKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8RXJyb3I+fSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG4gICAgdHJ5IHsgYXdhaXQgYnJva2VyLmNsb3NlKCkgfSBjYXRjaCAoZXJyb3IpIHsgZXJyb3JzLnB1c2godGhpcy5ub3JtYWxpemVFcnJvcihlcnJvcikpIH1cbiAgICBmb3IgKGNvbnN0IHtwb29sLCByZWdpc3RyYXRpb259IG9mIHRoaXMuc2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgfVxuICAgIHRoaXMuc2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbnMuY2xlYXIoKVxuICAgIGZvciAoY29uc3QgZW5yb2xsbWVudCBvZiB0aGlzLmVucm9sbG1lbnRzLnZhbHVlcygpKSB7XG4gICAgICB0cnkgeyBhd2FpdCB0aGlzLnJvbGxiYWNrQW5kUmVsZWFzZShlbnJvbGxtZW50KSB9IGNhdGNoIChlcnJvcikgeyBlcnJvcnMucHVzaCh0aGlzLm5vcm1hbGl6ZUVycm9yKGVycm9yKSkgfVxuICAgIH1cbiAgICB0aGlzLmVucm9sbG1lbnRzLmNsZWFyKClcbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiVGVzdCB0cmFuc2FjdGlvbiBzZXNzaW9uIHJvbGxiYWNrIGZhaWxlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMsIGRyYWlucywgcm9sbHMgYmFjaywgYW5kIHJlbGVhc2VzIGV2ZXJ5IGVucm9sbGVkIHBoeXNpY2FsIGNvbm5lY3Rpb24gZXhhY3RseSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpZGVtcG90ZW50IGNsZWFudXAuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwKCkge1xuICAgIGlmICh0aGlzLmNsZWFudXBQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5jbGVhbnVwUHJvbWlzZVxuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSB0aGlzLmNsZWFudXBBY3R1YWwoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsZWFudXBQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgaWRlbXBvdGVudCBjbGVhbnVwIG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFjdHVhbCBjbGVhbnVwLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cEFjdHVhbCgpIHtcbiAgICB0aGlzLnJldm9rZSgpXG4gICAgYXdhaXQgdGhpcy5yb2xsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBjYXBhYmlsaXR5LWZyZWUgc2Vzc2lvbiBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge3thY2NlcHRpbmc6IGJvb2xlYW4sIGVucm9sbG1lbnRDb3VudDogbnVtYmVyfX0gLSBDYXBhYmlsaXR5LWZyZWUgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBkZWJ1Z1NuYXBzaG90KCkge1xuICAgIHJldHVybiB7YWNjZXB0aW5nOiB0aGlzLmJyb2tlcj8uYWNjZXB0aW5nID09PSB0cnVlLCBlbnJvbGxtZW50Q291bnQ6IHRoaXMuZW5yb2xsbWVudHMuc2l6ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBiZWd1biBicm9rZXIuXG4gICAqIEByZXR1cm5zIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcn0gLSBCZWd1biBicm9rZXIuXG4gICAqL1xuICByZXF1aXJlZEJyb2tlcigpIHtcbiAgICBpZiAoIXRoaXMuYnJva2VyKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0IHRyYW5zYWN0aW9uIHNlc3Npb24gaGFzIG5vdCBiZWd1blwiKVxuICAgIHJldHVybiB0aGlzLmJyb2tlclxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgYW5kIHJlbGVhc2VzIG9uZSBvd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge0Vucm9sbG1lbnR9IGVucm9sbG1lbnQgLSBPd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb2xsYmFjayBhbmQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQW5kUmVsZWFzZShlbnJvbGxtZW50KSB7XG4gICAgLyoqIEB0eXBlIHtBcnJheTxFcnJvcj59ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cbiAgICB0cnkgeyBhd2FpdCBlbnJvbGxtZW50LmNvbm5lY3Rpb24ucm9sbGJhY2tUcmFuc2FjdGlvbigpIH0gY2F0Y2ggKGVycm9yKSB7IGVycm9ycy5wdXNoKHRoaXMubm9ybWFsaXplRXJyb3IoZXJyb3IpKSB9XG4gICAgdHJ5IHsgYXdhaXQgZW5yb2xsbWVudC5yZWxlYXNlKCkgfSBjYXRjaCAoZXJyb3IpIHsgZXJyb3JzLnB1c2godGhpcy5ub3JtYWxpemVFcnJvcihlcnJvcikpIH1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiVGVzdCB0cmFuc2FjdGlvbiBlbnJvbGxtZW50IGNsZWFudXAgZmFpbGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHRocm93biBjbGVhbnVwIHZhbHVlLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gT3BhcXVlIHRocm93biBjbGVhbnVwIHZhbHVlIG5hcnJvd2VkIGF0IHRoaXMgYm91bmRhcnkuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gLSBFcnJvciBpbnN0YW5jZS5cbiAgICovXG4gIG5vcm1hbGl6ZUVycm9yKGVycm9yKSB7IHJldHVybiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkgfVxufVxuIl19