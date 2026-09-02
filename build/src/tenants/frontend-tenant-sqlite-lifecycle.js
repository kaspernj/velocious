// @ts-check
/** @typedef {"closed" | "closing" | "deleting" | "open" | "opening"} LifecycleState */
/**
 * @typedef {object} LifecycleEntry
 * @property {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
 * @property {string} databaseIdentifier - Logical database identifier.
 * @property {boolean} dirty - Whether delayed writes remain.
 * @property {number} lastUsed - Monotonic recency sequence.
 * @property {number} pinCount - Active scoped pins.
 * @property {Promise<void> | undefined} readinessPromise - In-progress schema readiness.
 * @property {boolean} ready - Whether migrations and model metadata are ready.
 * @property {string | undefined} schemaGeneration - Ready or in-progress schema generation.
 * @property {LifecycleState} state - Current lifecycle state.
 */
const DEFAULT_MAX_OPEN_HANDLES = 10;
export default class FrontendTenantSqliteLifecycle {
    /**
     * Creates a lifecycle owner.
     * @param {{configuration: import("../configuration.js").default, maxOpenHandles?: number}} args - Lifecycle arguments.
     */
    constructor({ configuration, maxOpenHandles = DEFAULT_MAX_OPEN_HANDLES }) {
        if (!Number.isSafeInteger(maxOpenHandles) || maxOpenHandles < 1) {
            throw new TypeError("frontendTenantSqlite.maxOpenHandles must be a positive safe integer");
        }
        this.configuration = configuration;
        this.maxOpenHandles = maxOpenHandles;
        /** @type {Map<string, LifecycleEntry>} */
        this.entries = new Map();
        this.sequence = 0;
        this.queue = Promise.resolve();
    }
    key(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        return `${databaseIdentifier}:${this.configuration.getDatabasePool(databaseIdentifier).getConfigurationReuseKey(databaseConfiguration)}`;
    }
    assertSqlite(/** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        if (databaseConfiguration.type !== "sqlite")
            throw new Error("Frontend tenant lifecycle only supports SQLite databases");
    }
    async serialize(/** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback) {
        const previous = this.queue;
        let release = () => { };
        this.queue = new Promise((resolve) => { release = () => resolve(undefined); });
        await previous;
        try {
            return await callback();
        }
        finally {
            release();
        }
    }
    entry(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        const key = this.key(databaseIdentifier, databaseConfiguration);
        let entry = this.entries.get(key);
        if (!entry) {
            entry = {
                databaseConfiguration,
                databaseIdentifier,
                dirty: false,
                lastUsed: 0,
                pinCount: 0,
                readinessPromise: undefined,
                ready: false,
                schemaGeneration: undefined,
                state: "closed"
            };
            this.entries.set(key, entry);
        }
        return entry;
    }
    snapshot(/** @type {LifecycleEntry} */ entry) {
        return Object.freeze({
            databaseIdentifier: entry.databaseIdentifier,
            dirty: entry.dirty,
            lastUsed: entry.lastUsed,
            pinCount: entry.pinCount,
            ready: entry.ready,
            schemaGeneration: entry.schemaGeneration,
            state: entry.state
        });
    }
    async open(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        this.assertSqlite(databaseConfiguration);
        return await this.serialize(async () => {
            const entry = this.entry(databaseIdentifier, databaseConfiguration);
            if (entry.state === "open") {
                entry.lastUsed = ++this.sequence;
                return this.snapshot(entry);
            }
            await this.evictFor(entry);
            entry.state = "opening";
            try {
                await this.configuration.getDatabasePool(databaseIdentifier).openCapturedConnection(databaseConfiguration);
                entry.state = "open";
                entry.lastUsed = ++this.sequence;
                return this.snapshot(entry);
            }
            catch (error) {
                entry.state = "closed";
                throw error;
            }
        });
    }
    /**
     * Opens and prepares one captured physical tenant database generation. The
     * readiness callback runs outside the lifecycle bookkeeping lock, so distinct
     * tenant databases can migrate concurrently while matching callers share one
     * promise.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
     * @param {string} schemaGeneration - Application schema generation.
     * @param {() => Promise<void>} callback - Migration and metadata initialization.
     * @returns {Promise<Readonly<ReturnType<FrontendTenantSqliteLifecycle["snapshot"]>>>} - Ready lifecycle snapshot.
     */
    async initialize(databaseIdentifier, databaseConfiguration, schemaGeneration, callback) {
        this.assertSqlite(databaseConfiguration);
        if (!databaseConfiguration.tenantOnly)
            throw new Error("Frontend tenant database initialization requires a tenant-only SQLite database");
        if (typeof schemaGeneration !== "string" || schemaGeneration.length === 0) {
            throw new TypeError("Frontend tenant database initialization requires a non-empty schemaGeneration");
        }
        const readiness = await this.serialize(async () => {
            const entry = this.entry(databaseIdentifier, databaseConfiguration);
            if (entry.readinessPromise) {
                if (entry.schemaGeneration !== schemaGeneration) {
                    throw new Error(`Frontend tenant database is already initializing schema generation ${JSON.stringify(entry.schemaGeneration)}; cannot initialize mismatched generation ${JSON.stringify(schemaGeneration)}`);
                }
                return { entry, promise: entry.readinessPromise };
            }
            if (entry.ready && entry.schemaGeneration === schemaGeneration) {
                return { entry, promise: Promise.resolve() };
            }
            if (entry.schemaGeneration && entry.schemaGeneration !== schemaGeneration && (entry.pinCount > 0 || this.configuration.getDatabasePool(databaseIdentifier).capturedConnectionInUse(databaseConfiguration))) {
                throw new Error(`Cannot replace frontend tenant schema generation ${JSON.stringify(entry.schemaGeneration)} while its physical database is in use`);
            }
            if (entry.state !== "open")
                await this.openUnlocked(entry);
            if (entry.schemaGeneration && entry.schemaGeneration !== schemaGeneration) {
                this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration));
            }
            entry.ready = false;
            entry.schemaGeneration = schemaGeneration;
            entry.pinCount++;
            const promise = Promise.resolve().then(callback);
            entry.readinessPromise = promise;
            return { entry, promise };
        });
        try {
            await readiness.promise;
            await this.serialize(async () => {
                if (readiness.entry.readinessPromise === readiness.promise) {
                    readiness.entry.readinessPromise = undefined;
                    readiness.entry.ready = true;
                    readiness.entry.pinCount--;
                }
            });
        }
        catch (error) {
            await this.serialize(async () => {
                if (readiness.entry.readinessPromise === readiness.promise) {
                    readiness.entry.readinessPromise = undefined;
                    readiness.entry.ready = false;
                    readiness.entry.pinCount--;
                }
            });
            throw error;
        }
        return this.snapshot(readiness.entry);
    }
    async flush(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        this.assertSqlite(databaseConfiguration);
        return await this.serialize(async () => {
            const entry = this.entry(databaseIdentifier, databaseConfiguration);
            if (entry.state !== "open")
                await this.openUnlocked(entry);
            await this.configuration.getDatabasePool(databaseIdentifier).flushCapturedConnection(databaseConfiguration);
            entry.dirty = false;
            entry.lastUsed = ++this.sequence;
            return this.snapshot(entry);
        });
    }
    async close(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration, { flush = false } = {}) {
        this.assertSqlite(databaseConfiguration);
        return await this.serialize(async () => {
            const entry = this.entry(databaseIdentifier, databaseConfiguration);
            if (entry.state === "closed")
                return this.snapshot(entry);
            await this.assertClosable(entry);
            if (entry.dirty && !flush)
                throw new Error("Cannot close a dirty frontend tenant SQLite handle without flush: true");
            entry.state = "closing";
            try {
                if (flush)
                    await this.configuration.getDatabasePool(databaseIdentifier).flushCapturedConnection(databaseConfiguration);
                await this.configuration.getDatabasePool(databaseIdentifier).closeCapturedConnection(databaseConfiguration);
                this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration));
                entry.dirty = false;
                entry.ready = false;
                entry.schemaGeneration = undefined;
                entry.state = "closed";
                this.entries.delete(this.key(databaseIdentifier, databaseConfiguration));
                return this.snapshot(entry);
            }
            catch (error) {
                entry.state = "open";
                throw error;
            }
        });
    }
    async delete(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        this.assertSqlite(databaseConfiguration);
        return await this.serialize(async () => {
            const entry = this.entry(databaseIdentifier, databaseConfiguration);
            await this.assertClosable(entry);
            entry.state = "deleting";
            try {
                await this.configuration.getDatabasePool(databaseIdentifier).deleteCapturedDatabase(databaseConfiguration);
                this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration));
                entry.dirty = false;
                entry.ready = false;
                entry.schemaGeneration = undefined;
                entry.state = "closed";
                this.entries.delete(this.key(databaseIdentifier, databaseConfiguration));
                return this.snapshot(entry);
            }
            catch (error) {
                this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(databaseIdentifier, databaseConfiguration));
                entry.ready = false;
                entry.state = "closed";
                throw error;
            }
        });
    }
    inspect(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
        this.assertSqlite(databaseConfiguration);
        const entry = this.entries.get(this.key(databaseIdentifier, databaseConfiguration));
        return entry ? this.snapshot(entry) : Object.freeze({ databaseIdentifier, dirty: false, lastUsed: 0, pinCount: 0, ready: false, schemaGeneration: undefined, state: "closed" });
    }
    inspectAll() {
        const handles = [...this.entries.values()].map((entry) => this.snapshot(entry));
        return Object.freeze({ handles: Object.freeze(handles), maxOpenHandles: this.maxOpenHandles, openCount: handles.filter(({ state }) => state === "open").length });
    }
    reset() {
        for (const entry of this.entries.values()) {
            this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(entry.databaseIdentifier, entry.databaseConfiguration));
        }
        this.entries.clear();
    }
    async withPin(/** @type {string} */ databaseIdentifier, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration, /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback) {
        this.assertSqlite(databaseConfiguration);
        const entry = await this.serialize(async () => {
            const pinnedEntry = this.entry(databaseIdentifier, databaseConfiguration);
            if (pinnedEntry.state !== "open")
                await this.openUnlocked(pinnedEntry);
            pinnedEntry.pinCount++;
            pinnedEntry.lastUsed = ++this.sequence;
            return pinnedEntry;
        });
        try {
            return await callback();
        }
        finally {
            await this.serialize(async () => { entry.pinCount--; });
        }
    }
    /**
     * Atomically validates readiness, captures the schema generation, and pins
     * one lifecycle entry before starting database work.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
     * @param {{requireReady: boolean, schemaGeneration?: string}} options - Operation readiness requirements.
     * @param {(schemaGeneration: string | undefined) => Promise<ReturnType<typeof JSON.parse>>} callback - Pinned operation callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Operation result.
     */
    async databaseOperation(databaseIdentifier, databaseConfiguration, { requireReady, schemaGeneration }, callback) {
        if (databaseConfiguration.type !== "sqlite")
            return await callback(schemaGeneration);
        const entry = await this.serialize(async () => {
            const operationEntry = this.entries.get(this.key(databaseIdentifier, databaseConfiguration));
            if (requireReady && databaseConfiguration.tenantOnly && databaseConfiguration.migrations && !operationEntry?.ready) {
                const generation = operationEntry?.schemaGeneration ? ` for schema generation ${JSON.stringify(operationEntry.schemaGeneration)}` : "";
                throw new Error(`Frontend tenant database ${JSON.stringify(databaseIdentifier)} is not ready${generation}`);
            }
            if (!operationEntry)
                return undefined;
            if (schemaGeneration && operationEntry.schemaGeneration && schemaGeneration !== operationEntry.schemaGeneration) {
                throw new Error(`Frontend tenant database ${JSON.stringify(databaseIdentifier)} is on schema generation ${JSON.stringify(operationEntry.schemaGeneration)}, not ${JSON.stringify(schemaGeneration)}`);
            }
            if (operationEntry.state !== "open")
                await this.openUnlocked(operationEntry);
            operationEntry.pinCount++;
            operationEntry.lastUsed = ++this.sequence;
            return operationEntry;
        });
        const operationSchemaGeneration = schemaGeneration || entry?.schemaGeneration;
        if (!entry)
            return await callback(operationSchemaGeneration);
        try {
            return await callback(operationSchemaGeneration);
        }
        finally {
            const dirty = this.configuration.getDatabasePool(databaseIdentifier).capturedConnectionHasPendingWrites(databaseConfiguration);
            await this.serialize(async () => {
                entry.dirty ||= dirty;
                entry.lastUsed = ++this.sequence;
                entry.pinCount--;
            });
        }
    }
    async openUnlocked(/** @type {LifecycleEntry} */ entry) {
        await this.evictFor(entry);
        entry.state = "opening";
        try {
            await this.configuration.getDatabasePool(entry.databaseIdentifier).openCapturedConnection(entry.databaseConfiguration);
            entry.state = "open";
            entry.lastUsed = ++this.sequence;
        }
        catch (error) {
            entry.state = "closed";
            throw error;
        }
    }
    async assertClosable(/** @type {LifecycleEntry} */ entry) {
        if (entry.pinCount > 0)
            throw new Error("Cannot close a pinned frontend tenant SQLite handle");
        if (this.configuration.getDatabasePool(entry.databaseIdentifier).capturedConnectionInUse(entry.databaseConfiguration)) {
            throw new Error("Cannot close an in-use frontend tenant SQLite handle");
        }
    }
    async evictFor(/** @type {LifecycleEntry} */ openingEntry) {
        const openEntries = [...this.entries.values()].filter((entry) => entry !== openingEntry && entry.state === "open");
        if (openEntries.length < this.maxOpenHandles)
            return;
        const candidates = openEntries
            .filter((entry) => !entry.dirty && entry.pinCount === 0 && !this.configuration.getDatabasePool(entry.databaseIdentifier).capturedConnectionInUse(entry.databaseConfiguration))
            .sort((left, right) => left.lastUsed - right.lastUsed);
        const victim = candidates[0];
        if (!victim)
            throw new Error(`Frontend tenant SQLite handle capacity ${this.maxOpenHandles} reached; every handle is dirty, pinned, or in use`);
        await this.configuration.getDatabasePool(victim.databaseIdentifier).closeCapturedConnection(victim.databaseConfiguration);
        this.configuration.clearRecordMetadataForDatabaseIdentity(this.key(victim.databaseIdentifier, victim.databaseConfiguration));
        victim.ready = false;
        victim.schemaGeneration = undefined;
        victim.state = "closed";
        this.entries.delete(this.key(victim.databaseIdentifier, victim.databaseConfiguration));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtdGVuYW50LXNxbGl0ZS1saWZlY3ljbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVuYW50cy9mcm9udGVuZC10ZW5hbnQtc3FsaXRlLWxpZmVjeWNsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosdUZBQXVGO0FBQ3ZGOzs7Ozs7Ozs7OztHQVdHO0FBRUgsTUFBTSx3QkFBd0IsR0FBRyxFQUFFLENBQUE7QUFFbkMsTUFBTSxDQUFDLE9BQU8sT0FBTyw2QkFBNkI7SUFDaEQ7OztPQUdHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxjQUFjLEdBQUcsd0JBQXdCLEVBQUM7UUFDcEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsY0FBYyxDQUFDLElBQUksY0FBYyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2hFLE1BQU0sSUFBSSxTQUFTLENBQUMscUVBQXFFLENBQUMsQ0FBQTtRQUM1RixDQUFDO1FBRUQsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUE7UUFDcEMsMENBQTBDO1FBQzFDLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQTtRQUNqQixJQUFJLENBQUMsS0FBSyxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUNoQyxDQUFDO0lBRUQsR0FBRyxDQUFDLHFCQUFxQixDQUFDLGtCQUFrQixFQUFFLDRFQUE0RSxDQUFDLHFCQUFxQjtRQUM5SSxPQUFPLEdBQUcsa0JBQWtCLElBQUksSUFBSSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsa0JBQWtCLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLENBQUE7SUFDMUksQ0FBQztJQUVELFlBQVksQ0FBQyw0RUFBNEUsQ0FBQyxx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QyxrQkFBa0IsRUFBRSxNQUFNLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFBO1FBQzVILE1BQU0sQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO1FBQ3BCLE1BQU0sQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7UUFDbkMsTUFBTSxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUE7UUFDdkIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsa0JBQWtCLEVBQUUsTUFBTSxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQTtJQUN4RixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEB0eXBlZGVmIHtcImNsb3NlZFwiIHwgXCJjbG9zaW5nXCIgfCBcImRlbGV0aW5nXCIgfCBcIm9wZW5cIiB8IFwib3BlbmluZ1wifSBMaWZlY3ljbGVTdGF0ZSAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMaWZlY3ljbGVFbnRyeVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIENhcHR1cmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gTG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtib29sZWFufSBkaXJ0eSAtIFdoZXRoZXIgZGVsYXllZCB3cml0ZXMgcmVtYWluLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGxhc3RVc2VkIC0gTW9ub3RvbmljIHJlY2VuY3kgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcGluQ291bnQgLSBBY3RpdmUgc2NvcGVkIHBpbnMuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IHJlYWRpbmVzc1Byb21pc2UgLSBJbi1wcm9ncmVzcyBzY2hlbWEgcmVhZGluZXNzLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZWFkeSAtIFdoZXRoZXIgbWlncmF0aW9ucyBhbmQgbW9kZWwgbWV0YWRhdGEgYXJlIHJlYWR5LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHNjaGVtYUdlbmVyYXRpb24gLSBSZWFkeSBvciBpbi1wcm9ncmVzcyBzY2hlbWEgZ2VuZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7TGlmZWN5Y2xlU3RhdGV9IHN0YXRlIC0gQ3VycmVudCBsaWZlY3ljbGUgc3RhdGUuXG4gKi9cblxuY29uc3QgREVGQVVMVF9NQVhfT1BFTl9IQU5ETEVTID0gMTBcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGxpZmVjeWNsZSBvd25lci5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBtYXhPcGVuSGFuZGxlcz86IG51bWJlcn19IGFyZ3MgLSBMaWZlY3ljbGUgYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIG1heE9wZW5IYW5kbGVzID0gREVGQVVMVF9NQVhfT1BFTl9IQU5ETEVTfSkge1xuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIobWF4T3BlbkhhbmRsZXMpIHx8IG1heE9wZW5IYW5kbGVzIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImZyb250ZW5kVGVuYW50U3FsaXRlLm1heE9wZW5IYW5kbGVzIG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICB9XG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5tYXhPcGVuSGFuZGxlcyA9IG1heE9wZW5IYW5kbGVzXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBMaWZlY3ljbGVFbnRyeT59ICovXG4gICAgdGhpcy5lbnRyaWVzID0gbmV3IE1hcCgpXG4gICAgdGhpcy5zZXF1ZW5jZSA9IDBcbiAgICB0aGlzLnF1ZXVlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgfVxuXG4gIGtleSgvKiogQHR5cGUge3N0cmluZ30gKi8gZGF0YWJhc2VJZGVudGlmaWVyLCAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgcmV0dXJuIGAke2RhdGFiYXNlSWRlbnRpZmllcn06JHt0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcikuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbil9YFxuICB9XG5cbiAgYXNzZXJ0U3FsaXRlKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAoZGF0YWJhc2VDb25maWd1cmF0aW9uLnR5cGUgIT09IFwic3FsaXRlXCIpIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIHRlbmFudCBsaWZlY3ljbGUgb25seSBzdXBwb3J0cyBTUUxpdGUgZGF0YWJhc2VzXCIpXG4gIH1cblxuICBhc3luYyBzZXJpYWxpemUoLyoqIEB0eXBlIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMucXVldWVcbiAgICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gICAgdGhpcy5xdWV1ZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2UgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICBhd2FpdCBwcmV2aW91c1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZWxlYXNlKClcbiAgICB9XG4gIH1cblxuICBlbnRyeSgvKiogQHR5cGUge3N0cmluZ30gKi8gZGF0YWJhc2VJZGVudGlmaWVyLCAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy5rZXkoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgbGV0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChrZXkpXG4gICAgaWYgKCFlbnRyeSkge1xuICAgICAgZW50cnkgPSB7XG4gICAgICAgIGRhdGFiYXNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICBkaXJ0eTogZmFsc2UsXG4gICAgICAgIGxhc3RVc2VkOiAwLFxuICAgICAgICBwaW5Db3VudDogMCxcbiAgICAgICAgcmVhZGluZXNzUHJvbWlzZTogdW5kZWZpbmVkLFxuICAgICAgICByZWFkeTogZmFsc2UsXG4gICAgICAgIHNjaGVtYUdlbmVyYXRpb246IHVuZGVmaW5lZCxcbiAgICAgICAgc3RhdGU6IFwiY2xvc2VkXCJcbiAgICAgIH1cbiAgICAgIHRoaXMuZW50cmllcy5zZXQoa2V5LCBlbnRyeSlcbiAgICB9XG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICBzbmFwc2hvdCgvKiogQHR5cGUge0xpZmVjeWNsZUVudHJ5fSAqLyBlbnRyeSkge1xuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogZW50cnkuZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgZGlydHk6IGVudHJ5LmRpcnR5LFxuICAgICAgbGFzdFVzZWQ6IGVudHJ5Lmxhc3RVc2VkLFxuICAgICAgcGluQ291bnQ6IGVudHJ5LnBpbkNvdW50LFxuICAgICAgcmVhZHk6IGVudHJ5LnJlYWR5LFxuICAgICAgc2NoZW1hR2VuZXJhdGlvbjogZW50cnkuc2NoZW1hR2VuZXJhdGlvbixcbiAgICAgIHN0YXRlOiBlbnRyeS5zdGF0ZVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBvcGVuKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBkYXRhYmFzZUlkZW50aWZpZXIsIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAqLyBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pIHtcbiAgICB0aGlzLmFzc2VydFNxbGl0ZShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc2VyaWFsaXplKGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyeShkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICAgIGlmIChlbnRyeS5zdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgZW50cnkubGFzdFVzZWQgPSArK3RoaXMuc2VxdWVuY2VcbiAgICAgICAgcmV0dXJuIHRoaXMuc25hcHNob3QoZW50cnkpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZXZpY3RGb3IoZW50cnkpXG4gICAgICBlbnRyeS5zdGF0ZSA9IFwib3BlbmluZ1wiXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcikub3BlbkNhcHR1cmVkQ29ubmVjdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgICAgIGVudHJ5LnN0YXRlID0gXCJvcGVuXCJcbiAgICAgICAgZW50cnkubGFzdFVzZWQgPSArK3RoaXMuc2VxdWVuY2VcbiAgICAgICAgcmV0dXJuIHRoaXMuc25hcHNob3QoZW50cnkpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlbnRyeS5zdGF0ZSA9IFwiY2xvc2VkXCJcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIGFuZCBwcmVwYXJlcyBvbmUgY2FwdHVyZWQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlIGdlbmVyYXRpb24uIFRoZVxuICAgKiByZWFkaW5lc3MgY2FsbGJhY2sgcnVucyBvdXRzaWRlIHRoZSBsaWZlY3ljbGUgYm9va2tlZXBpbmcgbG9jaywgc28gZGlzdGluY3RcbiAgICogdGVuYW50IGRhdGFiYXNlcyBjYW4gbWlncmF0ZSBjb25jdXJyZW50bHkgd2hpbGUgbWF0Y2hpbmcgY2FsbGVycyBzaGFyZSBvbmVcbiAgICogcHJvbWlzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIENhcHR1cmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlbWFHZW5lcmF0aW9uIC0gQXBwbGljYXRpb24gc2NoZW1hIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBNaWdyYXRpb24gYW5kIG1ldGFkYXRhIGluaXRpYWxpemF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWFkb25seTxSZXR1cm5UeXBlPEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlW1wic25hcHNob3RcIl0+Pj59IC0gUmVhZHkgbGlmZWN5Y2xlIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZShkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgc2NoZW1hR2VuZXJhdGlvbiwgY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydFNxbGl0ZShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgdGVuYW50IGRhdGFiYXNlIGluaXRpYWxpemF0aW9uIHJlcXVpcmVzIGEgdGVuYW50LW9ubHkgU1FMaXRlIGRhdGFiYXNlXCIpXG4gICAgaWYgKHR5cGVvZiBzY2hlbWFHZW5lcmF0aW9uICE9PSBcInN0cmluZ1wiIHx8IHNjaGVtYUdlbmVyYXRpb24ubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnJvbnRlbmQgdGVuYW50IGRhdGFiYXNlIGluaXRpYWxpemF0aW9uIHJlcXVpcmVzIGEgbm9uLWVtcHR5IHNjaGVtYUdlbmVyYXRpb25cIilcbiAgICB9XG5cbiAgICBjb25zdCByZWFkaW5lc3MgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cnkoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICAgIGlmIChlbnRyeS5yZWFkaW5lc3NQcm9taXNlKSB7XG4gICAgICAgIGlmIChlbnRyeS5zY2hlbWFHZW5lcmF0aW9uICE9PSBzY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCB0ZW5hbnQgZGF0YWJhc2UgaXMgYWxyZWFkeSBpbml0aWFsaXppbmcgc2NoZW1hIGdlbmVyYXRpb24gJHtKU09OLnN0cmluZ2lmeShlbnRyeS5zY2hlbWFHZW5lcmF0aW9uKX07IGNhbm5vdCBpbml0aWFsaXplIG1pc21hdGNoZWQgZ2VuZXJhdGlvbiAke0pTT04uc3RyaW5naWZ5KHNjaGVtYUdlbmVyYXRpb24pfWApXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge2VudHJ5LCBwcm9taXNlOiBlbnRyeS5yZWFkaW5lc3NQcm9taXNlfVxuICAgICAgfVxuICAgICAgaWYgKGVudHJ5LnJlYWR5ICYmIGVudHJ5LnNjaGVtYUdlbmVyYXRpb24gPT09IHNjaGVtYUdlbmVyYXRpb24pIHtcbiAgICAgICAgcmV0dXJuIHtlbnRyeSwgcHJvbWlzZTogUHJvbWlzZS5yZXNvbHZlKCl9XG4gICAgICB9XG4gICAgICBpZiAoZW50cnkuc2NoZW1hR2VuZXJhdGlvbiAmJiBlbnRyeS5zY2hlbWFHZW5lcmF0aW9uICE9PSBzY2hlbWFHZW5lcmF0aW9uICYmIChlbnRyeS5waW5Db3VudCA+IDAgfHwgdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpLmNhcHR1cmVkQ29ubmVjdGlvbkluVXNlKGRhdGFiYXNlQ29uZmlndXJhdGlvbikpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJlcGxhY2UgZnJvbnRlbmQgdGVuYW50IHNjaGVtYSBnZW5lcmF0aW9uICR7SlNPTi5zdHJpbmdpZnkoZW50cnkuc2NoZW1hR2VuZXJhdGlvbil9IHdoaWxlIGl0cyBwaHlzaWNhbCBkYXRhYmFzZSBpcyBpbiB1c2VgKVxuICAgICAgfVxuICAgICAgaWYgKGVudHJ5LnN0YXRlICE9PSBcIm9wZW5cIikgYXdhaXQgdGhpcy5vcGVuVW5sb2NrZWQoZW50cnkpXG4gICAgICBpZiAoZW50cnkuc2NoZW1hR2VuZXJhdGlvbiAmJiBlbnRyeS5zY2hlbWFHZW5lcmF0aW9uICE9PSBzY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5jbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eSh0aGlzLmtleShkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlndXJhdGlvbikpXG4gICAgICB9XG5cbiAgICAgIGVudHJ5LnJlYWR5ID0gZmFsc2VcbiAgICAgIGVudHJ5LnNjaGVtYUdlbmVyYXRpb24gPSBzY2hlbWFHZW5lcmF0aW9uXG4gICAgICBlbnRyeS5waW5Db3VudCsrXG4gICAgICBjb25zdCBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihjYWxsYmFjaylcblxuICAgICAgZW50cnkucmVhZGluZXNzUHJvbWlzZSA9IHByb21pc2VcblxuICAgICAgcmV0dXJuIHtlbnRyeSwgcHJvbWlzZX1cbiAgICB9KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJlYWRpbmVzcy5wcm9taXNlXG4gICAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWFkaW5lc3MuZW50cnkucmVhZGluZXNzUHJvbWlzZSA9PT0gcmVhZGluZXNzLnByb21pc2UpIHtcbiAgICAgICAgICByZWFkaW5lc3MuZW50cnkucmVhZGluZXNzUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHJlYWRpbmVzcy5lbnRyeS5yZWFkeSA9IHRydWVcbiAgICAgICAgICByZWFkaW5lc3MuZW50cnkucGluQ291bnQtLVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWFkaW5lc3MuZW50cnkucmVhZGluZXNzUHJvbWlzZSA9PT0gcmVhZGluZXNzLnByb21pc2UpIHtcbiAgICAgICAgICByZWFkaW5lc3MuZW50cnkucmVhZGluZXNzUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgICAgICAgIHJlYWRpbmVzcy5lbnRyeS5yZWFkeSA9IGZhbHNlXG4gICAgICAgICAgcmVhZGluZXNzLmVudHJ5LnBpbkNvdW50LS1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuc25hcHNob3QocmVhZGluZXNzLmVudHJ5KVxuICB9XG5cbiAgYXN5bmMgZmx1c2goLyoqIEB0eXBlIHtzdHJpbmd9ICovIGRhdGFiYXNlSWRlbnRpZmllciwgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIHRoaXMuYXNzZXJ0U3FsaXRlKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zZXJpYWxpemUoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJ5KGRhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgICAgaWYgKGVudHJ5LnN0YXRlICE9PSBcIm9wZW5cIikgYXdhaXQgdGhpcy5vcGVuVW5sb2NrZWQoZW50cnkpXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcikuZmx1c2hDYXB0dXJlZENvbm5lY3Rpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgICAgZW50cnkuZGlydHkgPSBmYWxzZVxuICAgICAgZW50cnkubGFzdFVzZWQgPSArK3RoaXMuc2VxdWVuY2VcbiAgICAgIHJldHVybiB0aGlzLnNuYXBzaG90KGVudHJ5KVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBjbG9zZSgvKiogQHR5cGUge3N0cmluZ30gKi8gZGF0YWJhc2VJZGVudGlmaWVyLCAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7Zmx1c2ggPSBmYWxzZX0gPSB7fSkge1xuICAgIHRoaXMuYXNzZXJ0U3FsaXRlKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zZXJpYWxpemUoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJ5KGRhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgICAgaWYgKGVudHJ5LnN0YXRlID09PSBcImNsb3NlZFwiKSByZXR1cm4gdGhpcy5zbmFwc2hvdChlbnRyeSlcbiAgICAgIGF3YWl0IHRoaXMuYXNzZXJ0Q2xvc2FibGUoZW50cnkpXG4gICAgICBpZiAoZW50cnkuZGlydHkgJiYgIWZsdXNoKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2xvc2UgYSBkaXJ0eSBmcm9udGVuZCB0ZW5hbnQgU1FMaXRlIGhhbmRsZSB3aXRob3V0IGZsdXNoOiB0cnVlXCIpXG4gICAgICBlbnRyeS5zdGF0ZSA9IFwiY2xvc2luZ1wiXG4gICAgICB0cnkge1xuICAgICAgICBpZiAoZmx1c2gpIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5mbHVzaENhcHR1cmVkQ29ubmVjdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5jbG9zZUNhcHR1cmVkQ29ubmVjdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5jbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eSh0aGlzLmtleShkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlndXJhdGlvbikpXG4gICAgICAgIGVudHJ5LmRpcnR5ID0gZmFsc2VcbiAgICAgICAgZW50cnkucmVhZHkgPSBmYWxzZVxuICAgICAgICBlbnRyeS5zY2hlbWFHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgICAgIGVudHJ5LnN0YXRlID0gXCJjbG9zZWRcIlxuICAgICAgICB0aGlzLmVudHJpZXMuZGVsZXRlKHRoaXMua2V5KGRhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcbiAgICAgICAgcmV0dXJuIHRoaXMuc25hcHNob3QoZW50cnkpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlbnRyeS5zdGF0ZSA9IFwib3BlblwiXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZSgvKiogQHR5cGUge3N0cmluZ30gKi8gZGF0YWJhc2VJZGVudGlmaWVyLCAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gICAgdGhpcy5hc3NlcnRTcWxpdGUoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cnkoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgICBhd2FpdCB0aGlzLmFzc2VydENsb3NhYmxlKGVudHJ5KVxuICAgICAgZW50cnkuc3RhdGUgPSBcImRlbGV0aW5nXCJcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5kZWxldGVDYXB0dXJlZERhdGFiYXNlKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmNsZWFyUmVjb3JkTWV0YWRhdGFGb3JEYXRhYmFzZUlkZW50aXR5KHRoaXMua2V5KGRhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcbiAgICAgICAgZW50cnkuZGlydHkgPSBmYWxzZVxuICAgICAgICBlbnRyeS5yZWFkeSA9IGZhbHNlXG4gICAgICAgIGVudHJ5LnNjaGVtYUdlbmVyYXRpb24gPSB1bmRlZmluZWRcbiAgICAgICAgZW50cnkuc3RhdGUgPSBcImNsb3NlZFwiXG4gICAgICAgIHRoaXMuZW50cmllcy5kZWxldGUodGhpcy5rZXkoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pKVxuICAgICAgICByZXR1cm4gdGhpcy5zbmFwc2hvdChlbnRyeSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5jbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eSh0aGlzLmtleShkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlndXJhdGlvbikpXG4gICAgICAgIGVudHJ5LnJlYWR5ID0gZmFsc2VcbiAgICAgICAgZW50cnkuc3RhdGUgPSBcImNsb3NlZFwiXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGluc3BlY3QoLyoqIEB0eXBlIHtzdHJpbmd9ICovIGRhdGFiYXNlSWRlbnRpZmllciwgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgIHRoaXMuYXNzZXJ0U3FsaXRlKGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cmllcy5nZXQodGhpcy5rZXkoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pKVxuICAgIHJldHVybiBlbnRyeSA/IHRoaXMuc25hcHNob3QoZW50cnkpIDogT2JqZWN0LmZyZWV6ZSh7ZGF0YWJhc2VJZGVudGlmaWVyLCBkaXJ0eTogZmFsc2UsIGxhc3RVc2VkOiAwLCBwaW5Db3VudDogMCwgcmVhZHk6IGZhbHNlLCBzY2hlbWFHZW5lcmF0aW9uOiB1bmRlZmluZWQsIHN0YXRlOiBcImNsb3NlZFwifSlcbiAgfVxuXG4gIGluc3BlY3RBbGwoKSB7XG4gICAgY29uc3QgaGFuZGxlcyA9IFsuLi50aGlzLmVudHJpZXMudmFsdWVzKCldLm1hcCgoZW50cnkpID0+IHRoaXMuc25hcHNob3QoZW50cnkpKVxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtoYW5kbGVzOiBPYmplY3QuZnJlZXplKGhhbmRsZXMpLCBtYXhPcGVuSGFuZGxlczogdGhpcy5tYXhPcGVuSGFuZGxlcywgb3BlbkNvdW50OiBoYW5kbGVzLmZpbHRlcigoe3N0YXRlfSkgPT4gc3RhdGUgPT09IFwib3BlblwiKS5sZW5ndGh9KVxuICB9XG5cbiAgcmVzZXQoKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmVudHJpZXMudmFsdWVzKCkpIHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5jbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eSh0aGlzLmtleShlbnRyeS5kYXRhYmFzZUlkZW50aWZpZXIsIGVudHJ5LmRhdGFiYXNlQ29uZmlndXJhdGlvbikpXG4gICAgfVxuXG4gICAgdGhpcy5lbnRyaWVzLmNsZWFyKClcbiAgfVxuXG4gIGFzeW5jIHdpdGhQaW4oLyoqIEB0eXBlIHtzdHJpbmd9ICovIGRhdGFiYXNlSWRlbnRpZmllciwgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9ICovIGRhdGFiYXNlQ29uZmlndXJhdGlvbiwgLyoqIEB0eXBlIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gY2FsbGJhY2spIHtcbiAgICB0aGlzLmFzc2VydFNxbGl0ZShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgY29uc3QgZW50cnkgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwaW5uZWRFbnRyeSA9IHRoaXMuZW50cnkoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgICBpZiAocGlubmVkRW50cnkuc3RhdGUgIT09IFwib3BlblwiKSBhd2FpdCB0aGlzLm9wZW5VbmxvY2tlZChwaW5uZWRFbnRyeSlcbiAgICAgIHBpbm5lZEVudHJ5LnBpbkNvdW50KytcbiAgICAgIHBpbm5lZEVudHJ5Lmxhc3RVc2VkID0gKyt0aGlzLnNlcXVlbmNlXG4gICAgICByZXR1cm4gcGlubmVkRW50cnlcbiAgICB9KVxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7IGVudHJ5LnBpbkNvdW50LS0gfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSB2YWxpZGF0ZXMgcmVhZGluZXNzLCBjYXB0dXJlcyB0aGUgc2NoZW1hIGdlbmVyYXRpb24sIGFuZCBwaW5zXG4gICAqIG9uZSBsaWZlY3ljbGUgZW50cnkgYmVmb3JlIHN0YXJ0aW5nIGRhdGFiYXNlIHdvcmsuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBDYXB0dXJlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3tyZXF1aXJlUmVhZHk6IGJvb2xlYW4sIHNjaGVtYUdlbmVyYXRpb24/OiBzdHJpbmd9fSBvcHRpb25zIC0gT3BlcmF0aW9uIHJlYWRpbmVzcyByZXF1aXJlbWVudHMuXG4gICAqIEBwYXJhbSB7KHNjaGVtYUdlbmVyYXRpb246IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gUGlubmVkIG9wZXJhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE9wZXJhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkYXRhYmFzZU9wZXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge3JlcXVpcmVSZWFkeSwgc2NoZW1hR2VuZXJhdGlvbn0sIGNhbGxiYWNrKSB7XG4gICAgaWYgKGRhdGFiYXNlQ29uZmlndXJhdGlvbi50eXBlICE9PSBcInNxbGl0ZVwiKSByZXR1cm4gYXdhaXQgY2FsbGJhY2soc2NoZW1hR2VuZXJhdGlvbilcblxuICAgIGNvbnN0IGVudHJ5ID0gYXdhaXQgdGhpcy5zZXJpYWxpemUoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgb3BlcmF0aW9uRW50cnkgPSB0aGlzLmVudHJpZXMuZ2V0KHRoaXMua2V5KGRhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcblxuICAgICAgaWYgKHJlcXVpcmVSZWFkeSAmJiBkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSAmJiBkYXRhYmFzZUNvbmZpZ3VyYXRpb24ubWlncmF0aW9ucyAmJiAhb3BlcmF0aW9uRW50cnk/LnJlYWR5KSB7XG4gICAgICAgIGNvbnN0IGdlbmVyYXRpb24gPSBvcGVyYXRpb25FbnRyeT8uc2NoZW1hR2VuZXJhdGlvbiA/IGAgZm9yIHNjaGVtYSBnZW5lcmF0aW9uICR7SlNPTi5zdHJpbmdpZnkob3BlcmF0aW9uRW50cnkuc2NoZW1hR2VuZXJhdGlvbil9YCA6IFwiXCJcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIHRlbmFudCBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KGRhdGFiYXNlSWRlbnRpZmllcil9IGlzIG5vdCByZWFkeSR7Z2VuZXJhdGlvbn1gKVxuICAgICAgfVxuICAgICAgaWYgKCFvcGVyYXRpb25FbnRyeSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgICAgaWYgKHNjaGVtYUdlbmVyYXRpb24gJiYgb3BlcmF0aW9uRW50cnkuc2NoZW1hR2VuZXJhdGlvbiAmJiBzY2hlbWFHZW5lcmF0aW9uICE9PSBvcGVyYXRpb25FbnRyeS5zY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgdGVuYW50IGRhdGFiYXNlICR7SlNPTi5zdHJpbmdpZnkoZGF0YWJhc2VJZGVudGlmaWVyKX0gaXMgb24gc2NoZW1hIGdlbmVyYXRpb24gJHtKU09OLnN0cmluZ2lmeShvcGVyYXRpb25FbnRyeS5zY2hlbWFHZW5lcmF0aW9uKX0sIG5vdCAke0pTT04uc3RyaW5naWZ5KHNjaGVtYUdlbmVyYXRpb24pfWApXG4gICAgICB9XG4gICAgICBpZiAob3BlcmF0aW9uRW50cnkuc3RhdGUgIT09IFwib3BlblwiKSBhd2FpdCB0aGlzLm9wZW5VbmxvY2tlZChvcGVyYXRpb25FbnRyeSlcblxuICAgICAgb3BlcmF0aW9uRW50cnkucGluQ291bnQrK1xuICAgICAgb3BlcmF0aW9uRW50cnkubGFzdFVzZWQgPSArK3RoaXMuc2VxdWVuY2VcblxuICAgICAgcmV0dXJuIG9wZXJhdGlvbkVudHJ5XG4gICAgfSlcbiAgICBjb25zdCBvcGVyYXRpb25TY2hlbWFHZW5lcmF0aW9uID0gc2NoZW1hR2VuZXJhdGlvbiB8fCBlbnRyeT8uc2NoZW1hR2VuZXJhdGlvblxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvblNjaGVtYUdlbmVyYXRpb24pXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvblNjaGVtYUdlbmVyYXRpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IGRpcnR5ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpLmNhcHR1cmVkQ29ubmVjdGlvbkhhc1BlbmRpbmdXcml0ZXMoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuXG4gICAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZShhc3luYyAoKSA9PiB7XG4gICAgICAgIGVudHJ5LmRpcnR5IHx8PSBkaXJ0eVxuICAgICAgICBlbnRyeS5sYXN0VXNlZCA9ICsrdGhpcy5zZXF1ZW5jZVxuICAgICAgICBlbnRyeS5waW5Db3VudC0tXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIG9wZW5VbmxvY2tlZCgvKiogQHR5cGUge0xpZmVjeWNsZUVudHJ5fSAqLyBlbnRyeSkge1xuICAgIGF3YWl0IHRoaXMuZXZpY3RGb3IoZW50cnkpXG4gICAgZW50cnkuc3RhdGUgPSBcIm9wZW5pbmdcIlxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGVudHJ5LmRhdGFiYXNlSWRlbnRpZmllcikub3BlbkNhcHR1cmVkQ29ubmVjdGlvbihlbnRyeS5kYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgICBlbnRyeS5zdGF0ZSA9IFwib3BlblwiXG4gICAgICBlbnRyeS5sYXN0VXNlZCA9ICsrdGhpcy5zZXF1ZW5jZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlbnRyeS5zdGF0ZSA9IFwiY2xvc2VkXCJcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYXNzZXJ0Q2xvc2FibGUoLyoqIEB0eXBlIHtMaWZlY3ljbGVFbnRyeX0gKi8gZW50cnkpIHtcbiAgICBpZiAoZW50cnkucGluQ291bnQgPiAwKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2xvc2UgYSBwaW5uZWQgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBoYW5kbGVcIilcbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChlbnRyeS5kYXRhYmFzZUlkZW50aWZpZXIpLmNhcHR1cmVkQ29ubmVjdGlvbkluVXNlKGVudHJ5LmRhdGFiYXNlQ29uZmlndXJhdGlvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbG9zZSBhbiBpbi11c2UgZnJvbnRlbmQgdGVuYW50IFNRTGl0ZSBoYW5kbGVcIilcbiAgICB9XG4gIH1cblxuICBhc3luYyBldmljdEZvcigvKiogQHR5cGUge0xpZmVjeWNsZUVudHJ5fSAqLyBvcGVuaW5nRW50cnkpIHtcbiAgICBjb25zdCBvcGVuRW50cmllcyA9IFsuLi50aGlzLmVudHJpZXMudmFsdWVzKCldLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICE9PSBvcGVuaW5nRW50cnkgJiYgZW50cnkuc3RhdGUgPT09IFwib3BlblwiKVxuICAgIGlmIChvcGVuRW50cmllcy5sZW5ndGggPCB0aGlzLm1heE9wZW5IYW5kbGVzKSByZXR1cm5cbiAgICBjb25zdCBjYW5kaWRhdGVzID0gb3BlbkVudHJpZXNcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiAhZW50cnkuZGlydHkgJiYgZW50cnkucGluQ291bnQgPT09IDAgJiYgIXRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZW50cnkuZGF0YWJhc2VJZGVudGlmaWVyKS5jYXB0dXJlZENvbm5lY3Rpb25JblVzZShlbnRyeS5kYXRhYmFzZUNvbmZpZ3VyYXRpb24pKVxuICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0Lmxhc3RVc2VkIC0gcmlnaHQubGFzdFVzZWQpXG4gICAgY29uc3QgdmljdGltID0gY2FuZGlkYXRlc1swXVxuICAgIGlmICghdmljdGltKSB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIHRlbmFudCBTUUxpdGUgaGFuZGxlIGNhcGFjaXR5ICR7dGhpcy5tYXhPcGVuSGFuZGxlc30gcmVhY2hlZDsgZXZlcnkgaGFuZGxlIGlzIGRpcnR5LCBwaW5uZWQsIG9yIGluIHVzZWApXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh2aWN0aW0uZGF0YWJhc2VJZGVudGlmaWVyKS5jbG9zZUNhcHR1cmVkQ29ubmVjdGlvbih2aWN0aW0uZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5jbGVhclJlY29yZE1ldGFkYXRhRm9yRGF0YWJhc2VJZGVudGl0eSh0aGlzLmtleSh2aWN0aW0uZGF0YWJhc2VJZGVudGlmaWVyLCB2aWN0aW0uZGF0YWJhc2VDb25maWd1cmF0aW9uKSlcbiAgICB2aWN0aW0ucmVhZHkgPSBmYWxzZVxuICAgIHZpY3RpbS5zY2hlbWFHZW5lcmF0aW9uID0gdW5kZWZpbmVkXG4gICAgdmljdGltLnN0YXRlID0gXCJjbG9zZWRcIlxuICAgIHRoaXMuZW50cmllcy5kZWxldGUodGhpcy5rZXkodmljdGltLmRhdGFiYXNlSWRlbnRpZmllciwgdmljdGltLmRhdGFiYXNlQ29uZmlndXJhdGlvbikpXG4gIH1cbn1cbiJdfQ==