export type LifecycleState = "closed" | "closing" | "deleting" | "open" | "opening";
export type LifecycleEntry = {
    /**
     * - Captured physical configuration.
     */
    databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
    /**
     * - Logical database identifier.
     */
    databaseIdentifier: string;
    /**
     * - Whether delayed writes remain.
     */
    dirty: boolean;
    /**
     * - Monotonic recency sequence.
     */
    lastUsed: number;
    /**
     * - Active scoped pins.
     */
    pinCount: number;
    /**
     * - In-progress schema readiness.
     */
    readinessPromise: Promise<void> | undefined;
    /**
     * - Whether migrations and model metadata are ready.
     */
    ready: boolean;
    /**
     * - Ready or in-progress schema generation.
     */
    schemaGeneration: string | undefined;
    /**
     * - Current lifecycle state.
     */
    state: LifecycleState;
};
export default class FrontendTenantSqliteLifecycle {
    configuration: import("../configuration.js").default;
    maxOpenHandles: number;
    /** @type {Map<string, LifecycleEntry>} */
    entries: Map<string, LifecycleEntry>;
    sequence: number;
    queue: Promise<void>;
    /**
     * Creates a lifecycle owner.
     * @param {{configuration: import("../configuration.js").default, maxOpenHandles?: number}} args - Lifecycle arguments.
     */
    constructor({ configuration, maxOpenHandles }: {
        configuration: import("../configuration.js").default;
        maxOpenHandles?: number;
    });
    key(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): string;
    assertSqlite(/** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): void;
    serialize(/** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<any>;
    entry(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): LifecycleEntry;
    snapshot(/** @type {LifecycleEntry} */ entry: LifecycleEntry): Readonly<{
        databaseIdentifier: string;
        dirty: boolean;
        lastUsed: number;
        pinCount: number;
        ready: boolean;
        schemaGeneration: string | undefined;
        state: LifecycleState;
    }>;
    open(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): Promise<any>;
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
    initialize(databaseIdentifier: string, databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, schemaGeneration: string, callback: () => Promise<void>): Promise<Readonly<ReturnType<FrontendTenantSqliteLifecycle["snapshot"]>>>;
    flush(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): Promise<any>;
    close(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, { flush }?: {
        flush?: boolean | undefined;
    }): Promise<any>;
    delete(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): Promise<any>;
    inspect(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType): Readonly<{
        databaseIdentifier: string;
        dirty: boolean;
        lastUsed: number;
        pinCount: number;
        ready: boolean;
        schemaGeneration: string | undefined;
        state: LifecycleState;
    }>;
    inspectAll(): Readonly<{
        handles: readonly Readonly<{
            databaseIdentifier: string;
            dirty: boolean;
            lastUsed: number;
            pinCount: number;
            ready: boolean;
            schemaGeneration: string | undefined;
            state: LifecycleState;
        }>[];
        maxOpenHandles: number;
        openCount: number;
    }>;
    reset(): void;
    withPin(/** @type {string} */ databaseIdentifier: string, /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, /** @type {() => Promise<ReturnType<typeof JSON.parse>>} */ callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<any>;
    /**
     * Atomically validates readiness, captures the schema generation, and pins
     * one lifecycle entry before starting database work.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured physical configuration.
     * @param {{requireReady: boolean, schemaGeneration?: string}} options - Operation readiness requirements.
     * @param {(schemaGeneration: string | undefined) => Promise<ReturnType<typeof JSON.parse>>} callback - Pinned operation callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Operation result.
     */
    databaseOperation(databaseIdentifier: string, databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, { requireReady, schemaGeneration }: {
        requireReady: boolean;
        schemaGeneration?: string;
    }, callback: (schemaGeneration: string | undefined) => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    openUnlocked(/** @type {LifecycleEntry} */ entry: LifecycleEntry): Promise<void>;
    assertClosable(/** @type {LifecycleEntry} */ entry: LifecycleEntry): Promise<void>;
    evictFor(/** @type {LifecycleEntry} */ openingEntry: LifecycleEntry): Promise<void>;
}
//# sourceMappingURL=frontend-tenant-sqlite-lifecycle.d.ts.map