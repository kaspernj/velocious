// @ts-check
import Migrator from "../database/migrator.js";
/**
 * TenantDescriptorValue type.
 * @typedef {null | boolean | number | string | TenantDescriptorValue[] | {[key: string]: TenantDescriptorValue}} TenantDescriptorValue
 */
/** @typedef {{[key: string]: TenantDescriptorValue}} TenantDescriptor */
/** @typedef {{databaseIdentifier: string, dirty: boolean, lastUsed: number, pinCount: number, ready: boolean, schemaGeneration: string | undefined, state: "closed" | "closing" | "deleting" | "open" | "opening"}} TenantSqliteLifecycleSnapshot */
/**
 * Returns a readable path for a captured descriptor/configuration value.
 * @param {string} path - Parent path.
 * @param {string | number} key - Child key.
 * @returns {string} - Child path.
 */
function childPath(path, key) {
    if (typeof key === "number")
        return `${path}[${key}]`;
    return path ? `${path}.${key}` : key;
}
/**
 * Returns the runtime class label for an unsupported capture value.
 * @param {object} value - Unsupported value.
 * @returns {string} - Runtime class label.
 */
function valueClassName(value) {
    return value.constructor?.name || "object";
}
/**
 * Defines one captured key without invoking inherited setters such as
 * `Object.prototype.__proto__`.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} target - Captured object.
 * @param {string} key - Own key to define.
 * @param {ReturnType<typeof JSON.parse>} value - Captured value.
 */
function defineCapturedDataProperty(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
    });
}
/**
 * Deeply copies and freezes a JSON-compatible tenant descriptor value.
 * @param {ReturnType<typeof JSON.parse>} value - Value to capture.
 * @param {string} path - Descriptor path.
 * @param {Set<object>} ancestors - Active ancestor objects used for cycle detection.
 * @returns {TenantDescriptorValue} - Immutable captured value.
 */
function captureTenantValue(value, path, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (!value || typeof value !== "object") {
        throw new TypeError(`Tenant descriptor contains an unsupported value at ${path}: ${typeof value}`);
    }
    if (ancestors.has(value))
        throw new TypeError(`Tenant descriptor contains a cycle at ${path}`);
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            const capturedEntries = value.map((entry, index) => captureTenantValue(entry, childPath(path, index), ancestors));
            Object.freeze(capturedEntries);
            return capturedEntries;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`Tenant descriptor contains an unsupported value at ${path}: ${valueClassName(value)}`);
        }
        /** @type {TenantDescriptor} */
        const captured = {};
        for (const [key, entry] of Object.entries(value)) {
            defineCapturedDataProperty(captured, key, captureTenantValue(entry, childPath(path, key), ancestors));
        }
        return Object.freeze(captured);
    }
    finally {
        ancestors.delete(value);
    }
}
/**
 * Captures a root application tenant descriptor.
 * @param {object} tenant - Ordinary or null-prototype JSON-compatible tenant descriptor.
 * @returns {TenantDescriptor} - Immutable descriptor snapshot.
 */
function captureTenant(tenant) {
    return /** @type {TenantDescriptor} */ (captureTenantValue(tenant, "", new Set()));
}
/**
 * Deeply captures configuration values while retaining function/class identities.
 * Mutable non-plain runtime objects are rejected because retaining them would let
 * callers redirect a handle after construction.
 * @param {ReturnType<typeof JSON.parse>} value - Configuration value.
 * @param {string} path - Configuration path.
 * @param {Set<object>} ancestors - Active ancestor objects.
 * @returns {ReturnType<typeof JSON.parse>} - Immutable captured value.
 */
function captureConfigurationValue(value, path, ancestors) {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean" || typeof value === "number" || typeof value === "function") {
        return value;
    }
    if (typeof value !== "object") {
        throw new TypeError(`Tenant database configuration contains an unsupported value at ${path}: ${typeof value}`);
    }
    if (ancestors.has(value))
        throw new TypeError(`Tenant database configuration contains a cycle at ${path}`);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        if (Object.isFrozen(value))
            return value;
        throw new TypeError(`Tenant database configuration contains an unsupported mutable value at ${path}: ${valueClassName(value)}`);
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return Object.freeze(value.map((entry, index) => captureConfigurationValue(entry, childPath(path, index), ancestors)));
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const captured = {};
        for (const [key, entry] of Object.entries(value)) {
            defineCapturedDataProperty(captured, key, captureConfigurationValue(entry, childPath(path, key), ancestors));
        }
        return Object.freeze(captured);
    }
    finally {
        ancestors.delete(value);
    }
}
/**
 * Copies and deeply freezes a resolved physical database configuration.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Resolved database configuration.
 * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured configuration.
 */
function captureDatabaseConfiguration(databaseConfiguration) {
    return /** @type {import("../configuration-types.js").DatabaseConfigurationType} */ (captureConfigurationValue(databaseConfiguration, "databaseConfiguration", new Set()));
}
/**
 * Live-query source whose query is rebuilt inside one captured tenant operation
 * for every run.
 * @template {typeof import("../database/record/index.js").default} MC
 */
class TenantLiveQuerySource {
    /**
     * Creates a live-query source bound to an immutable tenant handle.
     * @param {object} args - Source arguments.
     * @param {string} args.databaseIdentifier - Captured logical database.
     * @param {TenantHandle} args.handle - Owning immutable tenant handle.
     * @param {MC} args.modelClass - Root model class.
     * @param {(query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void} [args.query] - Query builder.
     */
    constructor({ databaseIdentifier, handle, modelClass, query }) {
        modelClass._getConfiguration();
        handle.assertConfiguration(modelClass._getConfiguration());
        const modelDatabaseIdentifier = modelClass.getDatabaseIdentifier({ tenant: handle.tenant() });
        if (modelDatabaseIdentifier !== databaseIdentifier) {
            throw new Error(`${modelClass.getModelName()} uses database ${JSON.stringify(modelDatabaseIdentifier)}, not tenant live-query database ${JSON.stringify(databaseIdentifier)}`);
        }
        handle.databaseConfiguration(databaseIdentifier);
        this._databaseIdentifier = databaseIdentifier;
        this._handle = handle;
        this._modelClass = modelClass;
        this._query = query;
        Object.freeze(this);
    }
    /**
     * Returns the root model class.
     * @returns {MC} Root model class.
     */
    getModelClass() {
        return this._modelClass;
    }
    /**
     * Returns the captured physical identity for one observed model.
     * @param {typeof import("../database/record/index.js").default} modelClass - Observed model class.
     * @returns {string} Physical database identity.
     */
    databaseIdentityForModel(modelClass) {
        const databaseIdentifier = modelClass.getDatabaseIdentifier({ tenant: this._handle.tenant() });
        if (databaseIdentifier !== this._databaseIdentifier) {
            throw new Error(`${modelClass.getModelName()} uses database ${JSON.stringify(databaseIdentifier)}, not tenant live-query database ${JSON.stringify(this._databaseIdentifier)}`);
        }
        return this._handle.databaseIdentity(databaseIdentifier);
    }
    /**
     * Loads the current tenant rows through a fresh captured operation.
     * @returns {Promise<Array<InstanceType<MC>>>} Current tenant rows.
     */
    async toArray() {
        return await this._handle.databaseOperation({
            databaseIdentifier: this._databaseIdentifier,
            name: `Tenant live query: ${this._modelClass.getModelName()}`
        }, async (operation) => {
            await operation.ensureModelInitialized(this._modelClass);
            const baseQuery = operation.forModel(this._modelClass);
            const builtQuery = this._query ? this._query(baseQuery) || baseQuery : baseQuery;
            if (builtQuery.getModelClass().getModelName() !== this._modelClass.getModelName()) {
                throw new Error("Tenant live-query builder returned a query for another model");
            }
            if (builtQuery._operation !== operation) {
                throw new Error("Tenant live-query builder returned a query from another database operation");
            }
            return await builtQuery.toArray();
        });
    }
}
/**
 * Immutable tenant/database handle. Physical database configurations are
 * resolved and captured at construction, so later ambient tenant changes
 * cannot redirect work performed through this handle.
 */
export default class TenantHandle {
    /**
     * Runs constructor.
     * @param {object} args - Handle arguments.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {object} args.tenant - Ordinary or null-prototype JSON-compatible application tenant descriptor.
     */
    constructor({ configuration, tenant }) {
        if (!configuration)
            throw new Error("TenantHandle requires a configuration");
        if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
            throw new TypeError("TenantHandle requires a tenant object");
        }
        const capturedTenant = captureTenant(tenant);
        /** @type {Record<string, import("../configuration-types.js").DatabaseConfigurationType>} */
        const databaseConfigurations = Object.create(null);
        const disabledIdentifiers = configuration.getDisabledDatabaseIdentifiers();
        for (const identifier of Object.keys(configuration.getDatabaseConfiguration())) {
            if (disabledIdentifiers.has(identifier))
                continue;
            if (!configuration.isDatabaseIdentifierActive(identifier, capturedTenant))
                continue;
            databaseConfigurations[identifier] = captureDatabaseConfiguration(configuration.resolveDatabaseConfiguration(identifier, capturedTenant));
        }
        this._configuration = configuration;
        this._databaseConfigurations = Object.freeze(databaseConfigurations);
        this._tenant = capturedTenant;
        /** @type {WeakMap<typeof import("../database/record/index.js").default, {metadataKey: string, modelClass: typeof import("../database/record/index.js").default}>} */
        this._metadataModelClasses = new WeakMap();
        Object.freeze(this);
    }
    /**
     * Returns the captured tenant descriptor. Routing never re-resolves physical
     * identity from this value after handle construction.
     * @returns {TenantDescriptor} - Tenant descriptor.
     */
    tenant() {
        return this._tenant;
    }
    /**
     * Rejects using this handle with a different Configuration instance.
     * @param {import("../configuration.js").default} configuration - Expected owner.
     * @returns {void}
     */
    assertConfiguration(configuration) {
        if (configuration !== this._configuration) {
            throw new Error("Tenant handle belongs to a different Velocious configuration");
        }
    }
    /**
     * Returns the captured physical configuration for an active identifier.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured resolved configuration.
     */
    databaseConfiguration(databaseIdentifier) {
        const databaseConfiguration = this._databaseConfigurations[databaseIdentifier];
        if (!databaseConfiguration) {
            throw new Error(`Unknown or inactive database identifier for tenant handle: ${databaseIdentifier}`);
        }
        return databaseConfiguration;
    }
    /**
     * Returns the opaque captured physical database identity used by events,
     * live queries, and tenant-scoped sync state.
     * @param {string} databaseIdentifier - Logical database identifier.
     * @returns {string} Stable physical database identity.
     */
    databaseIdentity(databaseIdentifier) {
        const databaseConfiguration = this.databaseConfiguration(databaseIdentifier);
        const reuseKey = this._configuration
            .getDatabasePool(databaseIdentifier)
            .getConfigurationReuseKey(databaseConfiguration);
        return `${databaseIdentifier}:${reuseKey}`;
    }
    /**
     * Builds a live-query source permanently bound to this captured tenant.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {object} args - Live-query source arguments.
     * @param {string} args.databaseIdentifier - Logical tenant database.
     * @param {MC} args.modelClass - Root model class.
     * @param {(query: import("../database/query/model-class-query.js").default<MC>) => import("../database/query/model-class-query.js").default<MC> | void} [args.query] - Query builder run inside each captured operation.
     * @returns {TenantLiveQuerySource<MC>} Tenant-bound source.
     */
    liveQuery({ databaseIdentifier, modelClass, query }) {
        return new TenantLiveQuerySource({ databaseIdentifier, handle: this, modelClass, query });
    }
    /**
     * Returns a read-only model-class metadata view for this handle's ready
     * physical schema generation. Runtime queries must still use an operation.
     * @template {typeof import("../database/record/index.js").default} MC
     * @param {object} args - Metadata arguments.
     * @param {string} args.databaseIdentifier - Logical tenant database.
     * @param {MC} args.modelClass - Canonical model class.
     * @returns {MC} Generation-bound metadata view.
     */
    metadataModelClass({ databaseIdentifier, modelClass }) {
        modelClass._getConfiguration();
        this.assertConfiguration(modelClass._getConfiguration());
        const modelDatabaseIdentifier = modelClass.getDatabaseIdentifier({ tenant: this._tenant });
        if (modelDatabaseIdentifier !== databaseIdentifier) {
            throw new Error(`${modelClass.getModelName()} uses database ${JSON.stringify(modelDatabaseIdentifier)}, not tenant metadata database ${JSON.stringify(databaseIdentifier)}`);
        }
        const lifecycle = this.inspect({ databaseIdentifier });
        if (!lifecycle.ready || !lifecycle.schemaGeneration) {
            throw new Error(`Tenant database ${JSON.stringify(databaseIdentifier)} is not initialized for model metadata`);
        }
        const canonicalModelClass = /** @type {MC} */ (modelClass._recordMetadataModelClass || modelClass);
        const databaseIdentity = this.databaseIdentity(databaseIdentifier);
        const metadataKey = `${databaseIdentity.length}:${databaseIdentity}:${lifecycle.schemaGeneration}`;
        const existing = this._metadataModelClasses.get(canonicalModelClass);
        if (existing?.metadataKey === metadataKey)
            return /** @type {MC} */ (existing.modelClass);
        const metadataProperties = canonicalModelClass.recordMetadataPropertyNames();
        const metadataModelClass = new Proxy(canonicalModelClass, {
            get: (target, property, receiver) => {
                if (property === "_recordMetadataModelClass")
                    return target;
                if (typeof property === "string" && metadataProperties.has(property))
                    return target.recordMetadataValue(metadataKey, property);
                return Reflect.get(target, property, receiver);
            },
            set: (target, property, value, receiver) => {
                if (typeof property === "string" && metadataProperties.has(property)) {
                    target.setRecordMetadataValue(metadataKey, property, value);
                    return true;
                }
                return Reflect.set(target, property, value, receiver);
            }
        });
        this._metadataModelClasses.set(canonicalModelClass, { metadataKey, modelClass: metadataModelClass });
        return /** @type {MC} */ (metadataModelClass);
    }
    /**
     * Opens this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Safe lifecycle snapshot.
     */
    async open(options) {
        const { databaseIdentifier } = options;
        return await this._configuration.getFrontendTenantSqliteLifecycle().open(databaseIdentifier, this.databaseConfiguration(databaseIdentifier));
    }
    /**
     * Opens, migrates, and initializes record metadata for one captured physical
     * tenant SQLite database and application schema generation.
     * @param {object} options - Initialization options.
     * @param {string} options.databaseIdentifier - Tenant-only logical database identifier.
     * @param {import("../database/migrator/types.js").RequireMigrationContextType} options.migrations - Frontend migration require context.
     * @param {string} options.schemaGeneration - Stable application schema generation.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Ready lifecycle snapshot.
     */
    async initialize({ databaseIdentifier, migrations, schemaGeneration }) {
        if (!migrations || typeof migrations !== "function" || typeof migrations.keys !== "function") {
            throw new TypeError("TenantHandle.initialize requires a migrations require context");
        }
        const databaseConfiguration = this.databaseConfiguration(databaseIdentifier);
        const lifecycle = this._configuration.getFrontendTenantSqliteLifecycle();
        return await lifecycle.initialize(databaseIdentifier, databaseConfiguration, schemaGeneration, async () => {
            await this._databaseOperation({
                databaseIdentifier,
                name: `Initialize frontend tenant database: ${databaseIdentifier}`,
                requireReady: false,
                schemaGeneration
            }, async (operation) => {
                const migrator = new Migrator({ configuration: this._configuration, databaseIdentifiers: [databaseIdentifier] });
                operation.connection().clearSchemaCache();
                await migrator.migrateRequireContextForDatabase({
                    databaseConfiguration,
                    databaseIdentifier,
                    db: operation.connection(),
                    requireContext: migrations
                });
                await this._configuration.initializeModels({ type: "frontend-tenant" });
                for (const modelClass of Object.values(this._configuration.getModelClasses())) {
                    if (modelClass.getDatabaseIdentifier({ tenant: this._tenant }) !== databaseIdentifier)
                        continue;
                    const table = await operation.connection().getTableByName(modelClass.tableName(), { throwError: false });
                    if (!table && !modelClass.getEagerLoadRecordMetadata())
                        continue;
                    if (Object.keys(modelClass.getTranslationsMap()).length > 0) {
                        const translationsTable = await operation.connection().getTableByName(modelClass.getTranslationsTableName(), { throwError: false });
                        if (!translationsTable && !modelClass.getEagerLoadRecordMetadata())
                            continue;
                    }
                    await operation.ensureModelInitialized(modelClass);
                }
            });
        });
    }
    /**
     * Flushes this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Safe lifecycle snapshot.
     */
    async flush(options) {
        const { databaseIdentifier } = options;
        return await this._configuration.getFrontendTenantSqliteLifecycle().flush(databaseIdentifier, this.databaseConfiguration(databaseIdentifier));
    }
    /**
     * Closes this captured SQLite identity.
     * @param {{databaseIdentifier: string, flush?: boolean}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Safe lifecycle snapshot.
     */
    async close(options) {
        const { databaseIdentifier, flush = false } = options;
        return await this._configuration.getFrontendTenantSqliteLifecycle().close(databaseIdentifier, this.databaseConfiguration(databaseIdentifier), { flush });
    }
    /**
     * Deletes this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Promise<Readonly<TenantSqliteLifecycleSnapshot>>} - Closed lifecycle snapshot.
     */
    async delete(options) {
        const { databaseIdentifier } = options;
        return await this._configuration.getFrontendTenantSqliteLifecycle().delete(databaseIdentifier, this.databaseConfiguration(databaseIdentifier));
    }
    /**
     * Inspects this captured SQLite identity.
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @returns {Readonly<TenantSqliteLifecycleSnapshot>} - Safe lifecycle snapshot.
     */
    inspect(options) {
        const { databaseIdentifier } = options;
        return this._configuration.getFrontendTenantSqliteLifecycle().inspect(databaseIdentifier, this.databaseConfiguration(databaseIdentifier));
    }
    /**
     * Runs work while this captured SQLite identity is protected from eviction.
     * @template T
     * @param {{databaseIdentifier: string}} options - Lifecycle options.
     * @param {() => Promise<T>} callback - Pinned work.
     * @returns {Promise<T>} - Callback result.
     */
    async withPin({ databaseIdentifier }, callback) {
        return await this._configuration.getFrontendTenantSqliteLifecycle().withPin(databaseIdentifier, this.databaseConfiguration(databaseIdentifier), callback);
    }
    /**
     * Runs explicit ORM work on one pinned connection for this handle's captured
     * physical database. Use `operation.forModel(ModelClass)` for queries and
     * writes; loaded records and association/preload work retain that operation.
     * @template T
     * @param {{databaseIdentifier: string, name?: string}} options - Logical database and checkout name.
     * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Owned work callback.
     * @returns {Promise<T>} - Callback result.
     */
    async databaseOperation({ databaseIdentifier, name = "TenantHandle.databaseOperation" }, callback) {
        return await this._databaseOperation({ databaseIdentifier, name, requireReady: true }, callback);
    }
    /**
     * Runs a captured operation with explicit readiness policy. Initialization is
     * the only caller allowed to enter an unready schema generation.
     * @template T
     * @param {{databaseIdentifier: string, name: string, requireReady: boolean, schemaGeneration?: string}} options - Internal operation options.
     * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Operation callback.
     * @returns {Promise<T>} - Callback result.
     */
    async _databaseOperation({ databaseIdentifier, name, requireReady, schemaGeneration }, callback) {
        const databaseConfiguration = this.databaseConfiguration(databaseIdentifier);
        return await this._configuration.getFrontendTenantSqliteLifecycle().databaseOperation(databaseIdentifier, databaseConfiguration, { requireReady, schemaGeneration }, async (operationSchemaGeneration) => await this._configuration.withDatabaseOperation({
            databaseConfiguration,
            databaseIdentifier,
            name,
            schemaGeneration: operationSchemaGeneration,
            tenant: this._tenant
        }, callback));
    }
    /**
     * Runs explicit ORM work in a transaction pinned to this handle's captured
     * physical database.
     * @template T
     * @param {{databaseIdentifier: string, name?: string}} options - Logical database and checkout name.
     * @param {(operation: import("../database/operation.js").default) => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    async transaction({ databaseIdentifier, name = "TenantHandle.transaction" }, callback) {
        return await this.databaseOperation({ databaseIdentifier, name }, async (operation) => {
            return await operation.transaction(async () => await callback(operation));
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LWhhbmRsZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZW5hbnRzL3RlbmFudC1oYW5kbGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sUUFBUSxNQUFNLHlCQUF5QixDQUFBO0FBRTlDOzs7R0FHRztBQUNILHlFQUF5RTtBQUN6RSxxUEFBcVA7QUFFclA7Ozs7O0dBS0c7QUFDSCxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUUsR0FBRztJQUMxQixJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVE7UUFBRSxPQUFPLEdBQUcsSUFBSSxJQUFJLEdBQUcsR0FBRyxDQUFBO0lBRXJELE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFBO0FBQ3RDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxjQUFjLENBQUMsS0FBSztJQUMzQixPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsSUFBSSxJQUFJLFFBQVEsQ0FBQTtBQUM1QyxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUywwQkFBMEIsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFLEtBQUs7SUFDcEQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFO1FBQ2pDLFlBQVksRUFBRSxJQUFJO1FBQ2xCLFVBQVUsRUFBRSxJQUFJO1FBQ2hCLEtBQUs7UUFDTCxRQUFRLEVBQUUsSUFBSTtLQUNmLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsU0FBUztJQUNoRCxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLFNBQVM7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUMzRixJQUFJLE9B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LEVBQUMsa0JBQWtCLEVBQUUsSUFBSSxHQUFHLDBCQUEwQixFQUFDLEVBQUUsUUFBUTtRQUNqRixPQUFPLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsa0JBQWtCLEVBQUUsSUFBSSxFQUFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxFQUFFO1lBQ2xGLE9BQU8sTUFBTSxTQUFTLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtRQUMzRSxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgTWlncmF0b3IgZnJvbSBcIi4uL2RhdGFiYXNlL21pZ3JhdG9yLmpzXCJcblxuLyoqXG4gKiBUZW5hbnREZXNjcmlwdG9yVmFsdWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtudWxsIHwgYm9vbGVhbiB8IG51bWJlciB8IHN0cmluZyB8IFRlbmFudERlc2NyaXB0b3JWYWx1ZVtdIHwge1trZXk6IHN0cmluZ106IFRlbmFudERlc2NyaXB0b3JWYWx1ZX19IFRlbmFudERlc2NyaXB0b3JWYWx1ZVxuICovXG4vKiogQHR5cGVkZWYge3tba2V5OiBzdHJpbmddOiBUZW5hbnREZXNjcmlwdG9yVmFsdWV9fSBUZW5hbnREZXNjcmlwdG9yICovXG4vKiogQHR5cGVkZWYge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgZGlydHk6IGJvb2xlYW4sIGxhc3RVc2VkOiBudW1iZXIsIHBpbkNvdW50OiBudW1iZXIsIHJlYWR5OiBib29sZWFuLCBzY2hlbWFHZW5lcmF0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQsIHN0YXRlOiBcImNsb3NlZFwiIHwgXCJjbG9zaW5nXCIgfCBcImRlbGV0aW5nXCIgfCBcIm9wZW5cIiB8IFwib3BlbmluZ1wifX0gVGVuYW50U3FsaXRlTGlmZWN5Y2xlU25hcHNob3QgKi9cblxuLyoqXG4gKiBSZXR1cm5zIGEgcmVhZGFibGUgcGF0aCBmb3IgYSBjYXB0dXJlZCBkZXNjcmlwdG9yL2NvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhcmVudCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGtleSAtIENoaWxkIGtleS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ2hpbGQgcGF0aC5cbiAqL1xuZnVuY3Rpb24gY2hpbGRQYXRoKHBhdGgsIGtleSkge1xuICBpZiAodHlwZW9mIGtleSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIGAke3BhdGh9WyR7a2V5fV1gXG5cbiAgcmV0dXJuIHBhdGggPyBgJHtwYXRofS4ke2tleX1gIDoga2V5XG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgcnVudGltZSBjbGFzcyBsYWJlbCBmb3IgYW4gdW5zdXBwb3J0ZWQgY2FwdHVyZSB2YWx1ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSB2YWx1ZSAtIFVuc3VwcG9ydGVkIHZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBSdW50aW1lIGNsYXNzIGxhYmVsLlxuICovXG5mdW5jdGlvbiB2YWx1ZUNsYXNzTmFtZSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUuY29uc3RydWN0b3I/Lm5hbWUgfHwgXCJvYmplY3RcIlxufVxuXG4vKipcbiAqIERlZmluZXMgb25lIGNhcHR1cmVkIGtleSB3aXRob3V0IGludm9raW5nIGluaGVyaXRlZCBzZXR0ZXJzIHN1Y2ggYXNcbiAqIGBPYmplY3QucHJvdG90eXBlLl9fcHJvdG9fX2AuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdGFyZ2V0IC0gQ2FwdHVyZWQgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE93biBrZXkgdG8gZGVmaW5lLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYXB0dXJlZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZGVmaW5lQ2FwdHVyZWREYXRhUHJvcGVydHkodGFyZ2V0LCBrZXksIHZhbHVlKSB7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGtleSwge1xuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgIHZhbHVlLFxuICAgIHdyaXRhYmxlOiB0cnVlXG4gIH0pXG59XG5cbi8qKlxuICogRGVlcGx5IGNvcGllcyBhbmQgZnJlZXplcyBhIEpTT04tY29tcGF0aWJsZSB0ZW5hbnQgZGVzY3JpcHRvciB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gY2FwdHVyZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGVzY3JpcHRvciBwYXRoLlxuICogQHBhcmFtIHtTZXQ8b2JqZWN0Pn0gYW5jZXN0b3JzIC0gQWN0aXZlIGFuY2VzdG9yIG9iamVjdHMgdXNlZCBmb3IgY3ljbGUgZGV0ZWN0aW9uLlxuICogQHJldHVybnMge1RlbmFudERlc2NyaXB0b3JWYWx1ZX0gLSBJbW11dGFibGUgY2FwdHVyZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGNhcHR1cmVUZW5hbnRWYWx1ZSh2YWx1ZSwgcGF0aCwgYW5jZXN0b3JzKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBUZW5hbnQgZGVzY3JpcHRvciBjb250YWlucyBhbiB1bnN1cHBvcnRlZCB2YWx1ZSBhdCAke3BhdGh9OiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG4gIGlmIChhbmNlc3RvcnMuaGFzKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihgVGVuYW50IGRlc2NyaXB0b3IgY29udGFpbnMgYSBjeWNsZSBhdCAke3BhdGh9YClcblxuICBhbmNlc3RvcnMuYWRkKHZhbHVlKVxuXG4gIHRyeSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBjb25zdCBjYXB0dXJlZEVudHJpZXMgPSB2YWx1ZS5tYXAoKGVudHJ5LCBpbmRleCkgPT4gY2FwdHVyZVRlbmFudFZhbHVlKGVudHJ5LCBjaGlsZFBhdGgocGF0aCwgaW5kZXgpLCBhbmNlc3RvcnMpKVxuXG4gICAgICBPYmplY3QuZnJlZXplKGNhcHR1cmVkRW50cmllcylcblxuICAgICAgcmV0dXJuIGNhcHR1cmVkRW50cmllc1xuICAgIH1cblxuICAgIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICAgIGlmIChwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBUZW5hbnQgZGVzY3JpcHRvciBjb250YWlucyBhbiB1bnN1cHBvcnRlZCB2YWx1ZSBhdCAke3BhdGh9OiAke3ZhbHVlQ2xhc3NOYW1lKHZhbHVlKX1gKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7VGVuYW50RGVzY3JpcHRvcn0gKi9cbiAgICBjb25zdCBjYXB0dXJlZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIHtcbiAgICAgIGRlZmluZUNhcHR1cmVkRGF0YVByb3BlcnR5KGNhcHR1cmVkLCBrZXksIGNhcHR1cmVUZW5hbnRWYWx1ZShlbnRyeSwgY2hpbGRQYXRoKHBhdGgsIGtleSksIGFuY2VzdG9ycykpXG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoY2FwdHVyZWQpXG4gIH0gZmluYWxseSB7XG4gICAgYW5jZXN0b3JzLmRlbGV0ZSh2YWx1ZSlcbiAgfVxufVxuXG4vKipcbiAqIENhcHR1cmVzIGEgcm9vdCBhcHBsaWNhdGlvbiB0ZW5hbnQgZGVzY3JpcHRvci5cbiAqIEBwYXJhbSB7b2JqZWN0fSB0ZW5hbnQgLSBPcmRpbmFyeSBvciBudWxsLXByb3RvdHlwZSBKU09OLWNvbXBhdGlibGUgdGVuYW50IGRlc2NyaXB0b3IuXG4gKiBAcmV0dXJucyB7VGVuYW50RGVzY3JpcHRvcn0gLSBJbW11dGFibGUgZGVzY3JpcHRvciBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZVRlbmFudCh0ZW5hbnQpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7VGVuYW50RGVzY3JpcHRvcn0gKi8gKGNhcHR1cmVUZW5hbnRWYWx1ZSh0ZW5hbnQsIFwiXCIsIG5ldyBTZXQoKSkpXG59XG5cbi8qKlxuICogRGVlcGx5IGNhcHR1cmVzIGNvbmZpZ3VyYXRpb24gdmFsdWVzIHdoaWxlIHJldGFpbmluZyBmdW5jdGlvbi9jbGFzcyBpZGVudGl0aWVzLlxuICogTXV0YWJsZSBub24tcGxhaW4gcnVudGltZSBvYmplY3RzIGFyZSByZWplY3RlZCBiZWNhdXNlIHJldGFpbmluZyB0aGVtIHdvdWxkIGxldFxuICogY2FsbGVycyByZWRpcmVjdCBhIGhhbmRsZSBhZnRlciBjb25zdHJ1Y3Rpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmZpZ3VyYXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIENvbmZpZ3VyYXRpb24gcGF0aC5cbiAqIEBwYXJhbSB7U2V0PG9iamVjdD59IGFuY2VzdG9ycyAtIEFjdGl2ZSBhbmNlc3RvciBvYmplY3RzLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEltbXV0YWJsZSBjYXB0dXJlZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZUNvbmZpZ3VyYXRpb25WYWx1ZSh2YWx1ZSwgcGF0aCwgYW5jZXN0b3JzKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHJldHVybiB2YWx1ZVxuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBUZW5hbnQgZGF0YWJhc2UgY29uZmlndXJhdGlvbiBjb250YWlucyBhbiB1bnN1cHBvcnRlZCB2YWx1ZSBhdCAke3BhdGh9OiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG4gIGlmIChhbmNlc3RvcnMuaGFzKHZhbHVlKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihgVGVuYW50IGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gY29udGFpbnMgYSBjeWNsZSBhdCAke3BhdGh9YClcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSAmJiBwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBudWxsKSB7XG4gICAgaWYgKE9iamVjdC5pc0Zyb3plbih2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgVGVuYW50IGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gY29udGFpbnMgYW4gdW5zdXBwb3J0ZWQgbXV0YWJsZSB2YWx1ZSBhdCAke3BhdGh9OiAke3ZhbHVlQ2xhc3NOYW1lKHZhbHVlKX1gKVxuICB9XG5cbiAgYW5jZXN0b3JzLmFkZCh2YWx1ZSlcblxuICB0cnkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIE9iamVjdC5mcmVlemUodmFsdWUubWFwKChlbnRyeSwgaW5kZXgpID0+IGNhcHR1cmVDb25maWd1cmF0aW9uVmFsdWUoZW50cnksIGNoaWxkUGF0aChwYXRoLCBpbmRleCksIGFuY2VzdG9ycykpKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNhcHR1cmVkID0ge31cblxuICAgIGZvciAoY29uc3QgW2tleSwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkge1xuICAgICAgZGVmaW5lQ2FwdHVyZWREYXRhUHJvcGVydHkoY2FwdHVyZWQsIGtleSwgY2FwdHVyZUNvbmZpZ3VyYXRpb25WYWx1ZShlbnRyeSwgY2hpbGRQYXRoKHBhdGgsIGtleSksIGFuY2VzdG9ycykpXG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoY2FwdHVyZWQpXG4gIH0gZmluYWxseSB7XG4gICAgYW5jZXN0b3JzLmRlbGV0ZSh2YWx1ZSlcbiAgfVxufVxuXG4vKipcbiAqIENvcGllcyBhbmQgZGVlcGx5IGZyZWV6ZXMgYSByZXNvbHZlZCBwaHlzaWNhbCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIFJlc29sdmVkIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIENhcHR1cmVkIGNvbmZpZ3VyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGNhcHR1cmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uKSB7XG4gIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gKi8gKFxuICAgIGNhcHR1cmVDb25maWd1cmF0aW9uVmFsdWUoZGF0YWJhc2VDb25maWd1cmF0aW9uLCBcImRhdGFiYXNlQ29uZmlndXJhdGlvblwiLCBuZXcgU2V0KCkpXG4gIClcbn1cblxuLyoqXG4gKiBMaXZlLXF1ZXJ5IHNvdXJjZSB3aG9zZSBxdWVyeSBpcyByZWJ1aWx0IGluc2lkZSBvbmUgY2FwdHVyZWQgdGVuYW50IG9wZXJhdGlvblxuICogZm9yIGV2ZXJ5IHJ1bi5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNQ1xuICovXG5jbGFzcyBUZW5hbnRMaXZlUXVlcnlTb3VyY2Uge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGxpdmUtcXVlcnkgc291cmNlIGJvdW5kIHRvIGFuIGltbXV0YWJsZSB0ZW5hbnQgaGFuZGxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNvdXJjZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIENhcHR1cmVkIGxvZ2ljYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7VGVuYW50SGFuZGxlfSBhcmdzLmhhbmRsZSAtIE93bmluZyBpbW11dGFibGUgdGVuYW50IGhhbmRsZS5cbiAgICogQHBhcmFtIHtNQ30gYXJncy5tb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHsocXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+KSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPiB8IHZvaWR9IFthcmdzLnF1ZXJ5XSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZGF0YWJhc2VJZGVudGlmaWVyLCBoYW5kbGUsIG1vZGVsQ2xhc3MsIHF1ZXJ5fSkge1xuICAgIG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGhhbmRsZS5hc3NlcnRDb25maWd1cmF0aW9uKG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKSlcblxuICAgIGNvbnN0IG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogaGFuZGxlLnRlbmFudCgpfSlcblxuICAgIGlmIChtb2RlbERhdGFiYXNlSWRlbnRpZmllciAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gdXNlcyBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyKX0sIG5vdCB0ZW5hbnQgbGl2ZS1xdWVyeSBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KGRhdGFiYXNlSWRlbnRpZmllcil9YClcbiAgICB9XG5cbiAgICBoYW5kbGUuZGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9oYW5kbGUgPSBoYW5kbGVcbiAgICB0aGlzLl9tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMuX3F1ZXJ5ID0gcXVlcnlcbiAgICBPYmplY3QuZnJlZXplKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcm9vdCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge01DfSBSb290IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5fbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHBoeXNpY2FsIGlkZW50aXR5IGZvciBvbmUgb2JzZXJ2ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gT2JzZXJ2ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKi9cbiAgZGF0YWJhc2VJZGVudGl0eUZvck1vZGVsKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcih7dGVuYW50OiB0aGlzLl9oYW5kbGUudGVuYW50KCl9KVxuXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gdXNlcyBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KGRhdGFiYXNlSWRlbnRpZmllcil9LCBub3QgdGVuYW50IGxpdmUtcXVlcnkgZGF0YWJhc2UgJHtKU09OLnN0cmluZ2lmeSh0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2hhbmRsZS5kYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpZmllcilcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgY3VycmVudCB0ZW5hbnQgcm93cyB0aHJvdWdoIGEgZnJlc2ggY2FwdHVyZWQgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxJbnN0YW5jZVR5cGU8TUM+Pj59IEN1cnJlbnQgdGVuYW50IHJvd3MuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9oYW5kbGUuZGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBuYW1lOiBgVGVuYW50IGxpdmUgcXVlcnk6ICR7dGhpcy5fbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5fbW9kZWxDbGFzcylcbiAgICAgIGNvbnN0IGJhc2VRdWVyeSA9IG9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLl9tb2RlbENsYXNzKVxuICAgICAgY29uc3QgYnVpbHRRdWVyeSA9IHRoaXMuX3F1ZXJ5ID8gdGhpcy5fcXVlcnkoYmFzZVF1ZXJ5KSB8fCBiYXNlUXVlcnkgOiBiYXNlUXVlcnlcblxuICAgICAgaWYgKGJ1aWx0UXVlcnkuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpICE9PSB0aGlzLl9tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRlbmFudCBsaXZlLXF1ZXJ5IGJ1aWxkZXIgcmV0dXJuZWQgYSBxdWVyeSBmb3IgYW5vdGhlciBtb2RlbFwiKVxuICAgICAgfVxuICAgICAgaWYgKGJ1aWx0UXVlcnkuX29wZXJhdGlvbiAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRlbmFudCBsaXZlLXF1ZXJ5IGJ1aWxkZXIgcmV0dXJuZWQgYSBxdWVyeSBmcm9tIGFub3RoZXIgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBidWlsdFF1ZXJ5LnRvQXJyYXkoKVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBJbW11dGFibGUgdGVuYW50L2RhdGFiYXNlIGhhbmRsZS4gUGh5c2ljYWwgZGF0YWJhc2UgY29uZmlndXJhdGlvbnMgYXJlXG4gKiByZXNvbHZlZCBhbmQgY2FwdHVyZWQgYXQgY29uc3RydWN0aW9uLCBzbyBsYXRlciBhbWJpZW50IHRlbmFudCBjaGFuZ2VzXG4gKiBjYW5ub3QgcmVkaXJlY3Qgd29yayBwZXJmb3JtZWQgdGhyb3VnaCB0aGlzIGhhbmRsZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVuYW50SGFuZGxlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSGFuZGxlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncy50ZW5hbnQgLSBPcmRpbmFyeSBvciBudWxsLXByb3RvdHlwZSBKU09OLWNvbXBhdGlibGUgYXBwbGljYXRpb24gdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgdGVuYW50fSkge1xuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiVGVuYW50SGFuZGxlIHJlcXVpcmVzIGEgY29uZmlndXJhdGlvblwiKVxuICAgIGlmICghdGVuYW50IHx8IHR5cGVvZiB0ZW5hbnQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh0ZW5hbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiVGVuYW50SGFuZGxlIHJlcXVpcmVzIGEgdGVuYW50IG9iamVjdFwiKVxuICAgIH1cblxuICAgIGNvbnN0IGNhcHR1cmVkVGVuYW50ID0gY2FwdHVyZVRlbmFudCh0ZW5hbnQpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGU+fSAqL1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbnMgPSBPYmplY3QuY3JlYXRlKG51bGwpXG4gICAgY29uc3QgZGlzYWJsZWRJZGVudGlmaWVycyA9IGNvbmZpZ3VyYXRpb24uZ2V0RGlzYWJsZWREYXRhYmFzZUlkZW50aWZpZXJzKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhjb25maWd1cmF0aW9uLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpKSkge1xuICAgICAgaWYgKGRpc2FibGVkSWRlbnRpZmllcnMuaGFzKGlkZW50aWZpZXIpKSBjb250aW51ZVxuICAgICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIsIGNhcHR1cmVkVGVuYW50KSkgY29udGludWVcblxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uc1tpZGVudGlmaWVyXSA9IGNhcHR1cmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oXG4gICAgICAgIGNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihpZGVudGlmaWVyLCBjYXB0dXJlZFRlbmFudClcbiAgICAgIClcbiAgICB9XG5cbiAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX2RhdGFiYXNlQ29uZmlndXJhdGlvbnMgPSBPYmplY3QuZnJlZXplKGRhdGFiYXNlQ29uZmlndXJhdGlvbnMpXG4gICAgdGhpcy5fdGVuYW50ID0gY2FwdHVyZWRUZW5hbnRcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCB7bWV0YWRhdGFLZXk6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fT59ICovXG4gICAgdGhpcy5fbWV0YWRhdGFNb2RlbENsYXNzZXMgPSBuZXcgV2Vha01hcCgpXG5cbiAgICBPYmplY3QuZnJlZXplKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2FwdHVyZWQgdGVuYW50IGRlc2NyaXB0b3IuIFJvdXRpbmcgbmV2ZXIgcmUtcmVzb2x2ZXMgcGh5c2ljYWxcbiAgICogaWRlbnRpdHkgZnJvbSB0aGlzIHZhbHVlIGFmdGVyIGhhbmRsZSBjb25zdHJ1Y3Rpb24uXG4gICAqIEByZXR1cm5zIHtUZW5hbnREZXNjcmlwdG9yfSAtIFRlbmFudCBkZXNjcmlwdG9yLlxuICAgKi9cbiAgdGVuYW50KCkge1xuICAgIHJldHVybiB0aGlzLl90ZW5hbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIHVzaW5nIHRoaXMgaGFuZGxlIHdpdGggYSBkaWZmZXJlbnQgQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBFeHBlY3RlZCBvd25lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAoY29uZmlndXJhdGlvbiAhPT0gdGhpcy5fY29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGVuYW50IGhhbmRsZSBiZWxvbmdzIHRvIGEgZGlmZmVyZW50IFZlbG9jaW91cyBjb25maWd1cmF0aW9uXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gZm9yIGFuIGFjdGl2ZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gTG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIENhcHR1cmVkIHJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5fZGF0YWJhc2VDb25maWd1cmF0aW9uc1tkYXRhYmFzZUlkZW50aWZpZXJdXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9yIGluYWN0aXZlIGRhdGFiYXNlIGlkZW50aWZpZXIgZm9yIHRlbmFudCBoYW5kbGU6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGRhdGFiYXNlQ29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG9wYXF1ZSBjYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eSB1c2VkIGJ5IGV2ZW50cyxcbiAgICogbGl2ZSBxdWVyaWVzLCBhbmQgdGVuYW50LXNjb3BlZCBzeW5jIHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gTG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTdGFibGUgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqL1xuICBkYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuZGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCByZXVzZUtleSA9IHRoaXMuX2NvbmZpZ3VyYXRpb25cbiAgICAgIC5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXR1cm4gYCR7ZGF0YWJhc2VJZGVudGlmaWVyfToke3JldXNlS2V5fWBcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBsaXZlLXF1ZXJ5IHNvdXJjZSBwZXJtYW5lbnRseSBib3VuZCB0byB0aGlzIGNhcHR1cmVkIHRlbmFudC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1DXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTGl2ZS1xdWVyeSBzb3VyY2UgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIHRlbmFudCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtNQ30gYXJncy5tb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHsocXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+KSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPiB8IHZvaWR9IFthcmdzLnF1ZXJ5XSAtIFF1ZXJ5IGJ1aWxkZXIgcnVuIGluc2lkZSBlYWNoIGNhcHR1cmVkIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1RlbmFudExpdmVRdWVyeVNvdXJjZTxNQz59IFRlbmFudC1ib3VuZCBzb3VyY2UuXG4gICAqL1xuICBsaXZlUXVlcnkoe2RhdGFiYXNlSWRlbnRpZmllciwgbW9kZWxDbGFzcywgcXVlcnl9KSB7XG4gICAgcmV0dXJuIG5ldyBUZW5hbnRMaXZlUXVlcnlTb3VyY2Uoe2RhdGFiYXNlSWRlbnRpZmllciwgaGFuZGxlOiB0aGlzLCBtb2RlbENsYXNzLCBxdWVyeX0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHJlYWQtb25seSBtb2RlbC1jbGFzcyBtZXRhZGF0YSB2aWV3IGZvciB0aGlzIGhhbmRsZSdzIHJlYWR5XG4gICAqIHBoeXNpY2FsIHNjaGVtYSBnZW5lcmF0aW9uLiBSdW50aW1lIHF1ZXJpZXMgbXVzdCBzdGlsbCB1c2UgYW4gb3BlcmF0aW9uLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTUNcbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXRhZGF0YSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgdGVuYW50IGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge01DfSBhcmdzLm1vZGVsQ2xhc3MgLSBDYW5vbmljYWwgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtNQ30gR2VuZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSB2aWV3LlxuICAgKi9cbiAgbWV0YWRhdGFNb2RlbENsYXNzKHtkYXRhYmFzZUlkZW50aWZpZXIsIG1vZGVsQ2xhc3N9KSB7XG4gICAgbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmF0aW9uKG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKSlcblxuICAgIGNvbnN0IG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGhpcy5fdGVuYW50fSlcblxuICAgIGlmIChtb2RlbERhdGFiYXNlSWRlbnRpZmllciAhPT0gZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gdXNlcyBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyKX0sIG5vdCB0ZW5hbnQgbWV0YWRhdGEgZGF0YWJhc2UgJHtKU09OLnN0cmluZ2lmeShkYXRhYmFzZUlkZW50aWZpZXIpfWApXG4gICAgfVxuXG4gICAgY29uc3QgbGlmZWN5Y2xlID0gdGhpcy5pbnNwZWN0KHtkYXRhYmFzZUlkZW50aWZpZXJ9KVxuXG4gICAgaWYgKCFsaWZlY3ljbGUucmVhZHkgfHwgIWxpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KGRhdGFiYXNlSWRlbnRpZmllcil9IGlzIG5vdCBpbml0aWFsaXplZCBmb3IgbW9kZWwgbWV0YWRhdGFgKVxuICAgIH1cblxuICAgIGNvbnN0IGNhbm9uaWNhbE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge01DfSAqLyAobW9kZWxDbGFzcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzIHx8IG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGl0eSA9IHRoaXMuZGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgbWV0YWRhdGFLZXkgPSBgJHtkYXRhYmFzZUlkZW50aXR5Lmxlbmd0aH06JHtkYXRhYmFzZUlkZW50aXR5fToke2xpZmVjeWNsZS5zY2hlbWFHZW5lcmF0aW9ufWBcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuX21ldGFkYXRhTW9kZWxDbGFzc2VzLmdldChjYW5vbmljYWxNb2RlbENsYXNzKVxuXG4gICAgaWYgKGV4aXN0aW5nPy5tZXRhZGF0YUtleSA9PT0gbWV0YWRhdGFLZXkpIHJldHVybiAvKiogQHR5cGUge01DfSAqLyAoZXhpc3RpbmcubW9kZWxDbGFzcylcblxuICAgIGNvbnN0IG1ldGFkYXRhUHJvcGVydGllcyA9IGNhbm9uaWNhbE1vZGVsQ2xhc3MucmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzKClcbiAgICBjb25zdCBtZXRhZGF0YU1vZGVsQ2xhc3MgPSBuZXcgUHJveHkoY2Fub25pY2FsTW9kZWxDbGFzcywge1xuICAgICAgZ2V0OiAodGFyZ2V0LCBwcm9wZXJ0eSwgcmVjZWl2ZXIpID0+IHtcbiAgICAgICAgaWYgKHByb3BlcnR5ID09PSBcIl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3NcIikgcmV0dXJuIHRhcmdldFxuICAgICAgICBpZiAodHlwZW9mIHByb3BlcnR5ID09PSBcInN0cmluZ1wiICYmIG1ldGFkYXRhUHJvcGVydGllcy5oYXMocHJvcGVydHkpKSByZXR1cm4gdGFyZ2V0LnJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5KVxuXG4gICAgICAgIHJldHVybiBSZWZsZWN0LmdldCh0YXJnZXQsIHByb3BlcnR5LCByZWNlaXZlcilcbiAgICAgIH0sXG4gICAgICBzZXQ6ICh0YXJnZXQsIHByb3BlcnR5LCB2YWx1ZSwgcmVjZWl2ZXIpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBwcm9wZXJ0eSA9PT0gXCJzdHJpbmdcIiAmJiBtZXRhZGF0YVByb3BlcnRpZXMuaGFzKHByb3BlcnR5KSkge1xuICAgICAgICAgIHRhcmdldC5zZXRSZWNvcmRNZXRhZGF0YVZhbHVlKG1ldGFkYXRhS2V5LCBwcm9wZXJ0eSwgdmFsdWUpXG4gICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBSZWZsZWN0LnNldCh0YXJnZXQsIHByb3BlcnR5LCB2YWx1ZSwgcmVjZWl2ZXIpXG4gICAgICB9XG4gICAgfSlcblxuICAgIHRoaXMuX21ldGFkYXRhTW9kZWxDbGFzc2VzLnNldChjYW5vbmljYWxNb2RlbENsYXNzLCB7bWV0YWRhdGFLZXksIG1vZGVsQ2xhc3M6IG1ldGFkYXRhTW9kZWxDbGFzc30pXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtNQ30gKi8gKG1ldGFkYXRhTW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyB0aGlzIGNhcHR1cmVkIFNRTGl0ZSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmd9fSBvcHRpb25zIC0gTGlmZWN5Y2xlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlYWRvbmx5PFRlbmFudFNxbGl0ZUxpZmVjeWNsZVNuYXBzaG90Pj59IC0gU2FmZSBsaWZlY3ljbGUgc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBvcGVuKG9wdGlvbnMpIHtcbiAgICBjb25zdCB7ZGF0YWJhc2VJZGVudGlmaWVyfSA9IG9wdGlvbnNcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvbi5nZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpLm9wZW4oZGF0YWJhc2VJZGVudGlmaWVyLCB0aGlzLmRhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIpKVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zLCBtaWdyYXRlcywgYW5kIGluaXRpYWxpemVzIHJlY29yZCBtZXRhZGF0YSBmb3Igb25lIGNhcHR1cmVkIHBoeXNpY2FsXG4gICAqIHRlbmFudCBTUUxpdGUgZGF0YWJhc2UgYW5kIGFwcGxpY2F0aW9uIHNjaGVtYSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gb3B0aW9ucyAtIEluaXRpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLmRhdGFiYXNlSWRlbnRpZmllciAtIFRlbmFudC1vbmx5IGxvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IG9wdGlvbnMubWlncmF0aW9ucyAtIEZyb250ZW5kIG1pZ3JhdGlvbiByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnNjaGVtYUdlbmVyYXRpb24gLSBTdGFibGUgYXBwbGljYXRpb24gc2NoZW1hIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlYWRvbmx5PFRlbmFudFNxbGl0ZUxpZmVjeWNsZVNuYXBzaG90Pj59IC0gUmVhZHkgbGlmZWN5Y2xlIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZSh7ZGF0YWJhc2VJZGVudGlmaWVyLCBtaWdyYXRpb25zLCBzY2hlbWFHZW5lcmF0aW9ufSkge1xuICAgIGlmICghbWlncmF0aW9ucyB8fCB0eXBlb2YgbWlncmF0aW9ucyAhPT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiBtaWdyYXRpb25zLmtleXMgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlRlbmFudEhhbmRsZS5pbml0aWFsaXplIHJlcXVpcmVzIGEgbWlncmF0aW9ucyByZXF1aXJlIGNvbnRleHRcIilcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmRhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgbGlmZWN5Y2xlID0gdGhpcy5fY29uZmlndXJhdGlvbi5nZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgbGlmZWN5Y2xlLmluaXRpYWxpemUoZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHNjaGVtYUdlbmVyYXRpb24sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKHtcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICBuYW1lOiBgSW5pdGlhbGl6ZSBmcm9udGVuZCB0ZW5hbnQgZGF0YWJhc2U6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWAsXG4gICAgICAgIHJlcXVpcmVSZWFkeTogZmFsc2UsXG4gICAgICAgIHNjaGVtYUdlbmVyYXRpb25cbiAgICAgIH0sIGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgICAgY29uc3QgbWlncmF0b3IgPSBuZXcgTWlncmF0b3Ioe2NvbmZpZ3VyYXRpb246IHRoaXMuX2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcnM6IFtkYXRhYmFzZUlkZW50aWZpZXJdfSlcblxuICAgICAgICBvcGVyYXRpb24uY29ubmVjdGlvbigpLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICBhd2FpdCBtaWdyYXRvci5taWdyYXRlUmVxdWlyZUNvbnRleHRGb3JEYXRhYmFzZSh7XG4gICAgICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgICBkYjogb3BlcmF0aW9uLmNvbm5lY3Rpb24oKSxcbiAgICAgICAgICByZXF1aXJlQ29udGV4dDogbWlncmF0aW9uc1xuICAgICAgICB9KVxuICAgICAgICBhd2FpdCB0aGlzLl9jb25maWd1cmF0aW9uLmluaXRpYWxpemVNb2RlbHMoe3R5cGU6IFwiZnJvbnRlbmQtdGVuYW50XCJ9KVxuXG4gICAgICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBPYmplY3QudmFsdWVzKHRoaXMuX2NvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKCkpKSB7XG4gICAgICAgICAgaWYgKG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnQ6IHRoaXMuX3RlbmFudH0pICE9PSBkYXRhYmFzZUlkZW50aWZpZXIpIGNvbnRpbnVlXG4gICAgICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBvcGVyYXRpb24uY29ubmVjdGlvbigpLmdldFRhYmxlQnlOYW1lKG1vZGVsQ2xhc3MudGFibGVOYW1lKCksIHt0aHJvd0Vycm9yOiBmYWxzZX0pXG5cbiAgICAgICAgICBpZiAoIXRhYmxlICYmICFtb2RlbENsYXNzLmdldEVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKCkpIGNvbnRpbnVlXG4gICAgICAgICAgaWYgKE9iamVjdC5rZXlzKG1vZGVsQ2xhc3MuZ2V0VHJhbnNsYXRpb25zTWFwKCkpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zbGF0aW9uc1RhYmxlID0gYXdhaXQgb3BlcmF0aW9uLmNvbm5lY3Rpb24oKS5nZXRUYWJsZUJ5TmFtZShtb2RlbENsYXNzLmdldFRyYW5zbGF0aW9uc1RhYmxlTmFtZSgpLCB7dGhyb3dFcnJvcjogZmFsc2V9KVxuXG4gICAgICAgICAgICBpZiAoIXRyYW5zbGF0aW9uc1RhYmxlICYmICFtb2RlbENsYXNzLmdldEVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKCkpIGNvbnRpbnVlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQobW9kZWxDbGFzcylcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZsdXNoZXMgdGhpcyBjYXB0dXJlZCBTUUxpdGUgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gb3B0aW9ucyAtIExpZmVjeWNsZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWFkb25seTxUZW5hbnRTcWxpdGVMaWZlY3ljbGVTbmFwc2hvdD4+fSAtIFNhZmUgbGlmZWN5Y2xlIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgZmx1c2gob3B0aW9ucykge1xuICAgIGNvbnN0IHtkYXRhYmFzZUlkZW50aWZpZXJ9ID0gb3B0aW9uc1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb25maWd1cmF0aW9uLmdldEZyb250ZW5kVGVuYW50U3FsaXRlTGlmZWN5Y2xlKCkuZmx1c2goZGF0YWJhc2VJZGVudGlmaWVyLCB0aGlzLmRhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIpKVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGlzIGNhcHR1cmVkIFNRTGl0ZSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIGZsdXNoPzogYm9vbGVhbn19IG9wdGlvbnMgLSBMaWZlY3ljbGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVhZG9ubHk8VGVuYW50U3FsaXRlTGlmZWN5Y2xlU25hcHNob3Q+Pn0gLSBTYWZlIGxpZmVjeWNsZSBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIGNsb3NlKG9wdGlvbnMpIHtcbiAgICBjb25zdCB7ZGF0YWJhc2VJZGVudGlmaWVyLCBmbHVzaCA9IGZhbHNlfSA9IG9wdGlvbnNcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvbi5nZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpLmNsb3NlKGRhdGFiYXNlSWRlbnRpZmllciwgdGhpcy5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyKSwge2ZsdXNofSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRoaXMgY2FwdHVyZWQgU1FMaXRlIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZ319IG9wdGlvbnMgLSBMaWZlY3ljbGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVhZG9ubHk8VGVuYW50U3FsaXRlTGlmZWN5Y2xlU25hcHNob3Q+Pn0gLSBDbG9zZWQgbGlmZWN5Y2xlIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlKG9wdGlvbnMpIHtcbiAgICBjb25zdCB7ZGF0YWJhc2VJZGVudGlmaWVyfSA9IG9wdGlvbnNcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvbi5nZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpLmRlbGV0ZShkYXRhYmFzZUlkZW50aWZpZXIsIHRoaXMuZGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllcikpXG4gIH1cblxuICAvKipcbiAgICogSW5zcGVjdHMgdGhpcyBjYXB0dXJlZCBTUUxpdGUgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gb3B0aW9ucyAtIExpZmVjeWNsZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UmVhZG9ubHk8VGVuYW50U3FsaXRlTGlmZWN5Y2xlU25hcHNob3Q+fSAtIFNhZmUgbGlmZWN5Y2xlIHNuYXBzaG90LlxuICAgKi9cbiAgaW5zcGVjdChvcHRpb25zKSB7XG4gICAgY29uc3Qge2RhdGFiYXNlSWRlbnRpZmllcn0gPSBvcHRpb25zXG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb24uZ2V0RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoKS5pbnNwZWN0KGRhdGFiYXNlSWRlbnRpZmllciwgdGhpcy5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2hpbGUgdGhpcyBjYXB0dXJlZCBTUUxpdGUgaWRlbnRpdHkgaXMgcHJvdGVjdGVkIGZyb20gZXZpY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gb3B0aW9ucyAtIExpZmVjeWNsZSBvcHRpb25zLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGlubmVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdpdGhQaW4oe2RhdGFiYXNlSWRlbnRpZmllcn0sIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NvbmZpZ3VyYXRpb24uZ2V0RnJvbnRlbmRUZW5hbnRTcWxpdGVMaWZlY3ljbGUoKS53aXRoUGluKGRhdGFiYXNlSWRlbnRpZmllciwgdGhpcy5kYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyKSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBsaWNpdCBPUk0gd29yayBvbiBvbmUgcGlubmVkIGNvbm5lY3Rpb24gZm9yIHRoaXMgaGFuZGxlJ3MgY2FwdHVyZWRcbiAgICogcGh5c2ljYWwgZGF0YWJhc2UuIFVzZSBgb3BlcmF0aW9uLmZvck1vZGVsKE1vZGVsQ2xhc3MpYCBmb3IgcXVlcmllcyBhbmRcbiAgICogd3JpdGVzOyBsb2FkZWQgcmVjb3JkcyBhbmQgYXNzb2NpYXRpb24vcHJlbG9hZCB3b3JrIHJldGFpbiB0aGF0IG9wZXJhdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9fSBvcHRpb25zIC0gTG9naWNhbCBkYXRhYmFzZSBhbmQgY2hlY2tvdXQgbmFtZS5cbiAgICogQHBhcmFtIHsob3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9vcGVyYXRpb24uanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBPd25lZCB3b3JrIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkYXRhYmFzZU9wZXJhdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lID0gXCJUZW5hbnRIYW5kbGUuZGF0YWJhc2VPcGVyYXRpb25cIn0sIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKHtkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUsIHJlcXVpcmVSZWFkeTogdHJ1ZX0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYXB0dXJlZCBvcGVyYXRpb24gd2l0aCBleHBsaWNpdCByZWFkaW5lc3MgcG9saWN5LiBJbml0aWFsaXphdGlvbiBpc1xuICAgKiB0aGUgb25seSBjYWxsZXIgYWxsb3dlZCB0byBlbnRlciBhbiB1bnJlYWR5IHNjaGVtYSBnZW5lcmF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgbmFtZTogc3RyaW5nLCByZXF1aXJlUmVhZHk6IGJvb2xlYW4sIHNjaGVtYUdlbmVyYXRpb24/OiBzdHJpbmd9fSBvcHRpb25zIC0gSW50ZXJuYWwgb3BlcmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gT3BlcmF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfZGF0YWJhc2VPcGVyYXRpb24oe2RhdGFiYXNlSWRlbnRpZmllciwgbmFtZSwgcmVxdWlyZVJlYWR5LCBzY2hlbWFHZW5lcmF0aW9ufSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmRhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvbi5nZXRGcm9udGVuZFRlbmFudFNxbGl0ZUxpZmVjeWNsZSgpLmRhdGFiYXNlT3BlcmF0aW9uKFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgZGF0YWJhc2VDb25maWd1cmF0aW9uLFxuICAgICAge3JlcXVpcmVSZWFkeSwgc2NoZW1hR2VuZXJhdGlvbn0sXG4gICAgICBhc3luYyAob3BlcmF0aW9uU2NoZW1hR2VuZXJhdGlvbikgPT4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvbi53aXRoRGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgICBkYXRhYmFzZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgbmFtZSxcbiAgICAgICAgc2NoZW1hR2VuZXJhdGlvbjogb3BlcmF0aW9uU2NoZW1hR2VuZXJhdGlvbixcbiAgICAgICAgdGVuYW50OiB0aGlzLl90ZW5hbnRcbiAgICAgIH0sIGNhbGxiYWNrKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cGxpY2l0IE9STSB3b3JrIGluIGEgdHJhbnNhY3Rpb24gcGlubmVkIHRvIHRoaXMgaGFuZGxlJ3MgY2FwdHVyZWRcbiAgICogcGh5c2ljYWwgZGF0YWJhc2UuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBuYW1lPzogc3RyaW5nfX0gb3B0aW9ucyAtIExvZ2ljYWwgZGF0YWJhc2UgYW5kIGNoZWNrb3V0IG5hbWUuXG4gICAqIEBwYXJhbSB7KG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHRyYW5zYWN0aW9uKHtkYXRhYmFzZUlkZW50aWZpZXIsIG5hbWUgPSBcIlRlbmFudEhhbmRsZS50cmFuc2FjdGlvblwifSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5kYXRhYmFzZU9wZXJhdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24pKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==