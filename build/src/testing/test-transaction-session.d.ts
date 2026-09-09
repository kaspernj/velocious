import SharedTransactionBroker from "./shared-transaction-broker.js";
export type Enrollment = {
    connection: import("../database/drivers/base.js").default;
    databaseIdentifier: string;
    release: () => Promise<void>;
    reuseKey: string;
};
/** @typedef {{connection: import("../database/drivers/base.js").default, databaseIdentifier: string, release: () => Promise<void>, reuseKey: string}} Enrollment */
/**
 * Backend-owned, capability-scoped transaction set for long-lived test services.
 * Join coordinates are intentionally obtainable only as a live control message.
 */
export default class TestTransactionSession {
    configuration: import("../configuration.js").default | undefined;
    /** @type {SharedTransactionBroker | undefined} */
    broker: SharedTransactionBroker | undefined;
    /** @type {Map<string, Enrollment>} */
    enrollments: Map<string, Enrollment>;
    /** @type {Map<string, {pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}>} */
    sharedConnectionRegistrations: Map<string, {
        pool: import("../database/pool/base.js").default;
        registration: import("../database/pool/base.js").TestSharedConnectionRegistration;
    }>;
    /** @type {Promise<void> | undefined} */
    cleanupPromise: Promise<void> | undefined;
    /** @type {Promise<void> | undefined} */
    rollbackPromise: Promise<void> | undefined;
    /**
     * Creates an unstarted transaction session.
     * @param {import("../configuration.js").default} [configuration] - Backend configuration owning enrolled pools.
     */
    constructor(configuration?: import("../configuration.js").default);
    /**
     * Begins a test transaction session.
     * @param {{configuration?: import("../configuration.js").default}} [args] - Backend owner.
     * @returns {Promise<TestTransactionSession>} - Begun session.
     */
    static begin({ configuration }?: {
        configuration?: import("../configuration.js").default;
    }): Promise<TestTransactionSession>;
    /**
     * Joins one request/job callback from a live backend control message.
     * @template T
     * @param {{address: string, capability: string}} message - Ephemeral coordinates received over live IPC.
     * @param {() => T} callback - Backend request or worker work.
     * @returns {T} - Callback result.
     */
    static join<T>(message: {
        address: string;
        capability: string;
    }, callback: () => T): T;
    /**
     * Lazily adds an exact physical connection to the common rollback set.
     * @param {Enrollment} enrollment - Checked-out physical connection and owner release hook.
     */
    enroll(enrollment: Enrollment): Promise<void>;
    /**
     * Lazily checks out and enrolls the physical database selected by a tenant descriptor.
     * @param {{databaseIdentifier: string, tenant?: object}} args - Logical and tenant identity.
     */
    enrollDatabase({ databaseIdentifier, tenant }: {
        databaseIdentifier: string;
        tenant?: object;
    }): Promise<void>;
    /**
     * Makes in-process request/Scoundrel checkouts resolve by current physical identity.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @param {import("../database/pool/base.js").default} pool - Owning pool.
     */
    installSharedConnectionProvider(databaseIdentifier: string, pool: import("../database/pool/base.js").default): void;
    /**
     * Returns ephemeral coordinates for one live IPC/control message.
     * @returns {{address: string, capability: string}} - Non-durable join coordinates.
     */
    joinMessage(): {
        address: string;
        capability: string;
    };
    /** Stops admission to the capability. */
    revoke(): void;
    /** Drains work accepted before revocation. */
    drain(): Promise<void>;
    /**
     * Rolls back and releases the complete enrolled set after admission stops.
     * @returns {Promise<void>} - Resolves after rollback and release.
     */
    rollback(): Promise<void>;
    /**
     * Performs rollback and release once.
     * @returns {Promise<void>} - Resolves after actual rollback and release.
     */
    rollbackActual(): Promise<void>;
    /**
     * Revokes, drains, rolls back, and releases every enrolled physical connection exactly once.
     * @returns {Promise<void>} - Resolves after idempotent cleanup.
     */
    cleanup(): Promise<void>;
    /**
     * Performs idempotent cleanup once.
     * @returns {Promise<void>} - Resolves after actual cleanup.
     */
    cleanupActual(): Promise<void>;
    /**
     * Returns capability-free session diagnostics.
     * @returns {{accepting: boolean, enrollmentCount: number}} - Capability-free diagnostics.
     */
    debugSnapshot(): {
        accepting: boolean;
        enrollmentCount: number;
    };
    /**
     * Returns the begun broker.
     * @returns {SharedTransactionBroker} - Begun broker.
     */
    requiredBroker(): SharedTransactionBroker;
    /**
     * Rolls back and releases one owned physical connection.
     * @param {Enrollment} enrollment - Owned physical connection.
     * @returns {Promise<void>} - Resolves after rollback and release.
     */
    rollbackAndRelease(enrollment: Enrollment): Promise<void>;
    /**
     * Normalizes a thrown cleanup value.
     * @param {unknown} error - Opaque thrown cleanup value narrowed at this boundary.
     * @returns {Error} - Error instance.
     */
    normalizeError(error: unknown): Error;
}
//# sourceMappingURL=test-transaction-session.d.ts.map