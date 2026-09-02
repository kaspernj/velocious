import TenantHandle from "./tenant-handle.js";
/**
 * Model query/create scope bound to one immutable tenant handle.
 * @template {typeof import("../database/record/index.js").default} MC
 */
export default class TenantModelScope<MC extends typeof import("../database/record/index.js").default> {
    _handle: TenantHandle;
    _modelClass: MC;
    _databaseIdentifier: string;
    /**
     * Runs constructor.
     * @param {object} args - Scope arguments.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {MC} args.modelClass - Model class to bind.
     * @param {object} args.tenant - Ordinary or null-prototype JSON-compatible tenant descriptor.
     */
    constructor({ configuration, modelClass, tenant }: {
        configuration: import("../configuration.js").default;
        modelClass: MC;
        tenant: object;
    });
    /**
     * Runs a general model query/write callback on the captured physical tenant.
     * The query and every record/association it loads are owned by the operation
     * and must be used inside the callback.
     * @template T
     * @param {(query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>} callback - Bound model callback.
     * @returns {Promise<T>} - Callback result.
     */
    databaseOperation<T>(callback: (query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>): Promise<T>;
    /**
     * Runs a model callback in a transaction on the captured physical tenant.
     * @template T
     * @param {(query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    transaction<T>(callback: (query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>): Promise<T>;
    /**
     * Creates a record on the captured tenant.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Create attributes.
     * @returns {Promise<InstanceType<MC>>} - Created record.
     */
    create(attributes?: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<MC>>;
    /**
     * Counts records on the captured tenant.
     * @returns {Promise<number>} - Count on the captured tenant.
     */
    count(): Promise<number>;
    /**
     * Finds a record by primary key on the captured tenant.
     * @param {string | number} recordId - Record identifier.
     * @returns {Promise<InstanceType<MC> | null>} - Found record.
     */
    find(recordId: string | number): Promise<InstanceType<MC> | null>;
    /**
     * Finds a record by conditions on the captured tenant.
     * @param {Record<string, string | number>} conditions - Finder conditions.
     * @returns {Promise<InstanceType<MC> | null>} - Found record.
     */
    findBy(conditions: Record<string, string | number>): Promise<InstanceType<MC> | null>;
    /**
     * Finds a record by conditions or raises on the captured tenant.
     * @param {Record<string, string | number>} conditions - Finder conditions.
     * @returns {Promise<InstanceType<MC>>} - Found record.
     */
    findByOrFail(conditions: Record<string, string | number>): Promise<InstanceType<MC>>;
    /**
     * Loads all records on the captured tenant.
     * @returns {Promise<InstanceType<MC>[]>} - All records on the captured tenant.
     */
    toArray(): Promise<InstanceType<MC>[]>;
}
//# sourceMappingURL=tenant-model-scope.d.ts.map