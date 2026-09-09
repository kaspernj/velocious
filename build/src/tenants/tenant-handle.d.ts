export type TenantDescriptorValue = null | boolean | number | string | TenantDescriptorValue[] | {
    [key: string]: TenantDescriptorValue;
};
export type TenantDescriptor = {
    [key: string]: TenantDescriptorValue;
};
export type TenantSqliteLifecycleSnapshot = {
    databaseIdentifier: string;
    dirty: boolean;
    lastUsed: number;
    pinCount: number;
    ready: boolean;
    schemaGeneration: string | undefined;
    state: "closed" | "closing" | "deleting" | "open" | "opening";
};
/**
 * Live-query source whose query is rebuilt inside one captured tenant operation
 * for every run.
 * @template {typeof import("../database/record/index.js").default} MC
 */
declare class TenantLiveQuerySource<MC extends typeof import("../database/record/index.js").default> {
    _databaseIdentifier: string;
    _handle: TenantHandle;
    _modelClass: MC;
    _query: ((query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void) | undefined;
    /**
     * Creates a live-query source bound to an immutable tenant handle.
     * @param {object} args - Source arguments.
     * @param {string} args.databaseIdentifier - Captured logical database.
     * @param {TenantHandle} args.handle - Owning immutable tenant handle.
     * @param {MC} args.modelClass - Root model class.
     * @param {(query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void} [args.query] - Query builder.
     */
    constructor({ databaseIdentifier, handle, modelClass, query }: {
        databaseIdentifier: string;
        handle: TenantHandle;
        modelClass: MC;
        query?: (query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void;
    });
    /**
     * Returns the root model class.
     * @returns {MC} Root model class.
     */
    getModelClass(): MC;
    /**
     * Returns the captured physical identity for one observed model.
     * @param {typeof import("../database/record/index.js").default} modelClass - Observed model class.
     * @returns {string} Physical database identity.
     */
    databaseIdentityForModel(modelClass: typeof import("../database/record/index.js").default): string;
    /**
     * Loads the current tenant rows through a fresh captured operation.
     * @returns {Promise<Array<InstanceType<MC>>>} Current tenant rows.
     */
    toArray(): Promise<Array<InstanceType<MC>>>;
}
/**
 * Immutable tenant/database handle. Physical database configurations are
 * resolved and captured at construction, so later ambient tenant changes
 * cannot redirect work performed through this handle.
 */
export default class TenantHandle {
    _configuration: import("../configuration.js").default;
    _databaseConfigurations: Readonly<Record<string, import("../configuration-types.js").DatabaseConfigurationType>>;
    _tenant: TenantDescriptor;
    /** @type {WeakMap<typeof import("../database/record/index.js").default, {metadataKey: string, modelClass: typeof import("../database/record/index.js").default}>} */
    _metadataModelClasses: WeakMap<typeof import("../database/record/index.js").default, {
        metadataKey: string;
        modelClass: typeof import("../database/record/index.js").default;
    }>;
    /**
     * Runs constructor.
     * @param {object} args - Handle arguments.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {object} args.tenant - Ordinary or null-prototype JSON-compatible application tenant descriptor.
     */
    constructor({ configuration, tenant }: {
        configuration: import("../configuration.js").default;
        tenant: object;
    });
    /**
     * Returns the captured tenant descriptor. Routing never re-resolves physical
     * identity from this value after handle construction.
     * @returns {TenantDescriptor} - Tenant descriptor.
     */
    tenant(): TenantDescriptor;
    /**
     * Rejects using this handle with a different Configuration instance.
     * @param {import("../configuration.js").default} configuration - Expected owner.
     * @returns {void}
     */
    assertConfiguration(configuration: import("../configuration.js").default): void;
    /**
     * Returns the captured physical configuration for an active identifier.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured resolved configuration.
     */
    databaseConfiguration(databaseIdentifier: string): import("../configuration-types.js").DatabaseConfigurationType;
    /**
     * Returns the opaque captured physical database identity used by events,
     * live queries, and tenant-scoped sync state.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @returns {string} Stable physical database identity.
     */
    databaseIdentity(databaseIdentifier: string): string;
    /**
     * Builds a live-query source permanently bound to this captured tenant.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {object} args - Live-query source arguments.
     * @param {string} args.databaseIdentifier - Logical tenant database.
     * @param {MC} args.modelClass - Root model class.
     * @param {(query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void} [args.query] - Query builder run inside each captured operation.
     * @returns {TenantLiveQuerySource<MC>} Tenant-bound source.
     */
    liveQuery<MC extends typeof import("../database/record/index.js").default>({ databaseIdentifier, modelClass, query }: {
        databaseIdentifier: string;
        modelClass: MC;
        query?: (query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void;
    }): TenantLiveQuerySource<MC>;
    /**
     * Returns a read-only model-class metadata view for this handle's ready
     * physical schema generation. Runtime queries must still use an operation.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {object} args - Metadata arguments.
     * @param {string} args.databaseIdentifier - Logical tenant database.
     * @param {MC} args.modelClass - Canonical model class.
     * @returns {MC} Generation-bound metadata view.
     */
    metadataModelClass<MC extends typeof import("../database/record/index.js").default>({ databaseIdentifier, modelClass }: {
        databaseIdentifier: string;
        modelClass: MC;
    }): MC;
    /**
     * Opens this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Safe lifecycle snapshot.
     */
    open(options: {
        databaseIdentifier: string;
    }): Promise<Readonly<TenantSqliteLifecycleSnapshot>>;
    /**
     * Opens, migrates, and initializes record metadata for one captured physical
     * tenant SQLite database and application schema generation.
     * @param {object} options - Initialization options.
     * @param {string} options.databaseIdentifier - Tenant-only logical database identifier.
     * @param {import("../database/migrator/types.js").RequireMigrationContextType} options.migrations - Frontend migration require context.
     * @param {string} options.schemaGeneration - Stable application schema generation.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Ready lifecycle snapshot.
     */
    initialize({ databaseIdentifier, migrations, schemaGeneration }: {
        databaseIdentifier: string;
        migrations: import("../database/migrator/types.js").RequireMigrationContextType;
        schemaGeneration: string;
    }): Promise<Readonly<TenantSqliteLifecycleSnapshot>>;
    /**
     * Flushes this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Safe lifecycle snapshot.
     */
    flush(options: {
        databaseIdentifier: string;
    }): Promise<Readonly<TenantSqliteLifecycleSnapshot>>;
    /**
     * Closes this captured SQLite identity.
     * @param {{databaseIdentifier: string, flush?: boolean}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Safe lifecycle snapshot.
     */
    close(options: {
        databaseIdentifier: string;
        flush?: boolean;
    }): Promise<Readonly<TenantSqliteLifecycleSnapshot>>;
    /**
     * Deletes this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Closed lifecycle snapshot.
     */
    delete(options: {
        databaseIdentifier: string;
    }): Promise<Readonly<TenantSqliteLifecycleSnapshot>>;
    /**
     * Inspects this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Readonly<TenantSqliteLifecycleSnapshot>} - Safe lifecycle snapshot.
     */
    inspect(options: {
        databaseIdentifier: string;
    }): Readonly<TenantSqliteLifecycleSnapshot>;
    /**
     * Runs work while this captured SQLite identity is protected from eviction.
     * @template T
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @param {() => Promise<T>} callback - Pinned work.
     * @returns {Promise<T>} - Callback result.
     */
    withPin<T>({ databaseIdentifier }: {
        databaseIdentifier: string;
    }, callback: () => Promise<T>): Promise<T>;
    /**
     * Runs explicit ORM work on one pinned connection for this handle's captured
     * physical database. Use `operation.forModel(ModelClass)` for queries and
     * writes; loaded records and association/preload work retain that operation.
     * @template T
     * @param {{databaseIdentifier: string, name?: string}} options - Logical database and checkout name.
     * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Owned work callback.
     * @returns {Promise<T>} - Callback result.
     */
    databaseOperation<T>({ databaseIdentifier, name }: {
        databaseIdentifier: string;
        name?: string;
    }, callback: (operation: import("../database/operation.js").default) => Promise<T>): Promise<T>;
    /**
     * Runs a captured operation with explicit readiness policy. Initialization is
     * the only caller allowed to enter an unready schema generation.
     * @template T
     * @param {{databaseIdentifier: string, name: string, requireReady: boolean, schemaGeneration?: string}} options - Internal operation options.
     * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    _databaseOperation<T>({ databaseIdentifier, name, requireReady, schemaGeneration }: {
        databaseIdentifier: string;
        name: string;
        requireReady: boolean;
        schemaGeneration?: string;
    }, callback: (operation: import("../database/operation.js").default) => Promise<T>): Promise<T>;
    /**
     * Runs explicit ORM work in a transaction pinned to this handle's captured
     * physical database.
     * @template T
     * @param {{databaseIdentifier: string, name?: string}} options - Logical database and checkout name.
     * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    transaction<T>({ databaseIdentifier, name }: {
        databaseIdentifier: string;
        name?: string;
    }, callback: (operation: import("../database/operation.js").default) => Promise<T>): Promise<T>;
}
export {};
//# sourceMappingURL=tenant-handle.d.ts.map