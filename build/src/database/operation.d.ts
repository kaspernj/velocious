import OperationConnection from "./operation-connection.js";
/**
 * Explicit owner for model work performed on one pinned transactional
 * connection.
 */
export default class VelociousDatabaseOperation {
    _active: boolean;
    _configuration: import("../configuration.js").default;
    _databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
    _configurationReuseKey: string;
    _databaseIdentifier: string;
    _enforceCurrentTenantReuseKey: boolean;
    _physicalConnection: import("./drivers/base.js").default;
    _schemaGeneration: string | undefined;
    _tenant: object | undefined;
    /** @type {WeakMap<typeof import("./record/index.js").default, typeof import("./record/index.js").default>} */
    _boundModelClasses: WeakMap<typeof import("./record/index.js").default, typeof import("./record/index.js").default>;
    _connection: OperationConnection;
    /**
     * Runs constructor.
     * @param {object} args - Operation ownership.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {boolean} [args.enforceCurrentTenantReuseKey] - Whether ambient tenant changes invalidate this legacy operation.
     * @param {import("../configuration-types.js").DatabaseConfigurationType} [args.databaseConfiguration] - Captured resolved physical database configuration.
     * @param {string} args.configurationReuseKey - Physical database configuration key captured at checkout.
     * @param {import("./drivers/base.js").default} args.connection - Pinned physical connection.
     * @param {string} args.databaseIdentifier - Singular database identifier.
     * @param {symbol} args.owner - Opaque pool lease owner.
     * @param {string} [args.schemaGeneration] - Tenant schema generation owning record metadata.
     * @param {object | undefined} args.tenant - Tenant descriptor captured by the owning handle.
     */
    constructor({ configuration, databaseConfiguration, configurationReuseKey, connection, databaseIdentifier, enforceCurrentTenantReuseKey, owner, schemaGeneration, tenant }: {
        configuration: import("../configuration.js").default;
        enforceCurrentTenantReuseKey?: boolean;
        databaseConfiguration?: import("../configuration-types.js").DatabaseConfigurationType;
        configurationReuseKey: string;
        connection: import("./drivers/base.js").default;
        databaseIdentifier: string;
        owner: symbol;
        schemaGeneration?: string;
        tenant: object | undefined;
    });
    /**
     * Returns an operation-bound model query/create scope.
     * @template {typeof import("./record/index.js").default} MC
     * @param {MC} ModelClass - Model class to bind.
     * @returns {import("./query/model-class-query.js").default<MC>} - Operation-bound scope.
     */
    forModel<MC extends typeof import("./record/index.js").default>(ModelClass: MC): import("./query/model-class-query.js").default<MC>;
    /**
     * Returns a model-class view whose schema metadata is bound to this physical
     * database generation. Construction still produces the application's original
     * model class, so lifecycle callbacks and model registries retain class identity.
     * @template {typeof import("./record/index.js").default} MC
     * @param {MC} ModelClass - Canonical model class.
     * @returns {MC} - Operation-bound model class.
     */
    modelClass<MC extends typeof import("./record/index.js").default>(ModelClass: MC): MC;
    /**
     * Verifies that a model belongs to this operation's configuration and database.
     * @param {typeof import("./record/index.js").default} ModelClass - Model class to verify.
     * @returns {void}
     */
    assertModel(ModelClass: typeof import("./record/index.js").default): void;
    /**
     * Binds a loaded or built record to this operation.
     * @template {import("./record/index.js").default} Model
     * @param {Model} record - Record to bind.
     * @returns {Model} - Bound record.
     */
    bindRecord<Model extends import("./record/index.js").default>(record: Model): Model;
    /**
     * Registers a callback owned by the current operation transaction frame.
     * @param {() => void | Promise<void>} callback - Callback.
     * @returns {Promise<void>} - Resolves after registration or execution.
     */
    afterCommit(callback: () => void | Promise<void>): Promise<void>;
    /**
     * Registers a guard owned by the current transaction/savepoint frame.
     * @param {(context: {operation: VelociousDatabaseOperation}) => void | Promise<void>} callback - Guard callback.
     * @returns {Promise<void>} - Resolves after registration.
     */
    beforeCommit(callback: (context: {
        operation: VelociousDatabaseOperation;
    }) => void | Promise<void>): Promise<void>;
    /**
     * Runs a nested operation transaction/savepoint.
     * @template T
     * @param {() => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    transaction<T>(callback: () => Promise<T>): Promise<T>;
    /**
     * Returns the deliberately exposed operation connection facade for raw SQL.
     * @returns {import("./drivers/base.js").default} - Operation-bound connection.
     */
    connection(): import("./drivers/base.js").default;
    /**
     * Returns the tenant descriptor captured by the immutable handle.
     * @returns {Record<string, unknown> | undefined} - Captured tenant descriptor.
     */
    tenant(): Record<string, unknown> | undefined;
    /**
     * Returns the logical database identifier owned by this operation.
     * @returns {string} - Database identifier.
     */
    databaseIdentifier(): string;
    /**
     * Returns a stable physical-database identity suitable for operation-aware caches.
     * @returns {string} - Physical database identity.
     */
    databaseIdentity(): string;
    /**
     * Returns the tenant schema generation captured when this operation started.
     * @returns {string | undefined} - Captured schema generation.
     */
    schemaGeneration(): string | undefined;
    /**
     * Initializes a model through this operation's captured connection.
     * @param {typeof import("./record/index.js").default} ModelClass - Model class.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    ensureModelInitialized(ModelClass: typeof import("./record/index.js").default): Promise<void>;
    /**
     * Raises when an operation handle has left its callback.
     * @returns {void}
     */
    assertActive(): void;
    /**
     * Expires the operation and all scopes/records bound to it.
     * @returns {void}
     */
    complete(): void;
}
//# sourceMappingURL=operation.d.ts.map