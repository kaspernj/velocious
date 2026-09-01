// @ts-check
import OperationConnection from "./operation-connection.js";
/**
 * Explicit owner for model work performed on one pinned transactional
 * connection.
 */
export default class VelociousDatabaseOperation {
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
    constructor({ configuration, databaseConfiguration, configurationReuseKey, connection, databaseIdentifier, enforceCurrentTenantReuseKey = true, owner, schemaGeneration, tenant }) {
        this._active = true;
        this._configuration = configuration;
        this._databaseConfiguration = databaseConfiguration || configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant);
        this._configurationReuseKey = configurationReuseKey;
        this._databaseIdentifier = databaseIdentifier;
        this._enforceCurrentTenantReuseKey = enforceCurrentTenantReuseKey;
        this._physicalConnection = connection;
        this._schemaGeneration = schemaGeneration;
        this._tenant = tenant;
        /** @type {WeakMap<typeof import("./record/index.js").default, typeof import("./record/index.js").default>} */
        this._boundModelClasses = new WeakMap();
        this._connection = new OperationConnection({
            connection,
            operation: this,
            owner
        });
    }
    /**
     * Returns an operation-bound model query/create scope.
     * @template {typeof import("./record/index.js").default} MC
     * @param {MC} ModelClass - Model class to bind.
     * @returns {import("./query/model-class-query.js").default<MC>} - Operation-bound scope.
     */
    forModel(ModelClass) {
        this.assertActive();
        this.assertModel(ModelClass);
        return this.modelClass(ModelClass)._newQuery({
            driver: this.connection(),
            operation: this
        });
    }
    /**
     * Returns a model-class view whose schema metadata is bound to this physical
     * database generation. Construction still produces the application's original
     * model class, so lifecycle callbacks and model registries retain class identity.
     * @template {typeof import("./record/index.js").default} MC
     * @param {MC} ModelClass - Canonical model class.
     * @returns {MC} - Operation-bound model class.
     */
    modelClass(ModelClass) {
        if (!this._schemaGeneration)
            return ModelClass;
        const canonicalModelClass = /** @type {MC} */ (ModelClass._recordMetadataModelClass || ModelClass);
        const existing = this._boundModelClasses.get(canonicalModelClass);
        if (existing)
            return /** @type {MC} */ (existing);
        const databaseIdentity = this.databaseIdentity();
        const metadataKey = `${databaseIdentity.length}:${databaseIdentity}:${this._schemaGeneration}`;
        const metadataProperties = canonicalModelClass.recordMetadataPropertyNames();
        const boundModelClass = new Proxy(canonicalModelClass, {
            construct: (target, args, newTarget) => Reflect.construct(target, args, newTarget),
            get: (target, property, receiver) => {
                if (property === "_recordMetadataModelClass")
                    return target;
                if (property === "_recordMetadataBinder")
                    return (/** @type {typeof import("./record/index.js").default} */ targetModelClass) => this.modelClass(targetModelClass);
                if (property === "_recordMetadataOperation")
                    return this;
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
        this._boundModelClasses.set(canonicalModelClass, boundModelClass);
        return /** @type {MC} */ (boundModelClass);
    }
    /**
     * Verifies that a model belongs to this operation's configuration and database.
     * @param {typeof import("./record/index.js").default} ModelClass - Model class to verify.
     * @returns {void}
     */
    assertModel(ModelClass) {
        if (ModelClass._getConfiguration() !== this._configuration) {
            throw new Error(`${ModelClass.getModelName()} belongs to another Velocious configuration`);
        }
        const modelDatabaseIdentifier = ModelClass.getDatabaseIdentifier({ tenant: this._tenant });
        if (modelDatabaseIdentifier !== this._databaseIdentifier) {
            throw new Error(`${ModelClass.getModelName()} uses database ${JSON.stringify(modelDatabaseIdentifier)}, not operation database ${JSON.stringify(this._databaseIdentifier)}`);
        }
    }
    /**
     * Binds a loaded or built record to this operation.
     * @template {import("./record/index.js").default} Model
     * @param {Model} record - Record to bind.
     * @returns {Model} - Bound record.
     */
    bindRecord(record) {
        this.assertActive();
        this.assertModel(record.getModelClass());
        record.bindDatabaseOperation(this);
        record.captureDatabaseIdentity(this.databaseIdentity());
        return record;
    }
    /**
     * Registers a callback owned by the current operation transaction frame.
     * @param {() => void | Promise<void>} callback - Callback.
     * @returns {Promise<void>} - Resolves after registration or execution.
     */
    async afterCommit(callback) {
        this.assertActive();
        await this.connection().afterCommit(callback);
    }
    /**
     * Registers a guard owned by the current transaction/savepoint frame.
     * @param {(context: {operation: VelociousDatabaseOperation}) => void | Promise<void>} callback - Guard callback.
     * @returns {Promise<void>} - Resolves after registration.
     */
    async beforeCommit(callback) {
        this.assertActive();
        await this.connection().beforeCommit(() => callback({ operation: this }));
    }
    /**
     * Runs a nested operation transaction/savepoint.
     * @template T
     * @param {() => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    async transaction(callback) {
        this.assertActive();
        return await this.connection().transaction(callback);
    }
    /**
     * Returns the deliberately exposed operation connection facade for raw SQL.
     * @returns {import("./drivers/base.js").default} - Operation-bound connection.
     */
    connection() {
        this.assertActive();
        /**
         * Narrows the Proxy facade to the complete driver surface that it forwards.
         * @type {import("./drivers/base.js").default}
         */
        const connectionFacade = /** @type {ReturnType<typeof JSON.parse>} */ (this._connection);
        return connectionFacade;
    }
    /**
     * Returns the tenant descriptor captured by the immutable handle.
     * @returns {Record<string, unknown> | undefined} - Captured tenant descriptor.
     */
    tenant() {
        return /** @type {Record<string, unknown> | undefined} */ (this._tenant);
    }
    /**
     * Returns the logical database identifier owned by this operation.
     * @returns {string} - Database identifier.
     */
    databaseIdentifier() {
        return this._databaseIdentifier;
    }
    /**
     * Returns a stable physical-database identity suitable for operation-aware caches.
     * @returns {string} - Physical database identity.
     */
    databaseIdentity() {
        return `${this._databaseIdentifier}:${this._configurationReuseKey}`;
    }
    /**
     * Returns the tenant schema generation captured when this operation started.
     * @returns {string | undefined} - Captured schema generation.
     */
    schemaGeneration() {
        return this._schemaGeneration;
    }
    /**
     * Initializes a model through this operation's captured connection.
     * @param {typeof import("./record/index.js").default} ModelClass - Model class.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    async ensureModelInitialized(ModelClass) {
        this.assertActive();
        const boundModelClass = this.modelClass(ModelClass);
        if (boundModelClass.isInitialized())
            this.assertModel(ModelClass);
        await boundModelClass.ensureInitialized({
            configuration: this._configuration,
            connection: this.connection()
        });
        this.assertModel(ModelClass);
    }
    /**
     * Raises when an operation handle has left its callback.
     * @returns {void}
     */
    assertActive() {
        if (!this._active)
            throw new Error("Database operation has completed");
        const pool = this
            ._configuration
            .getDatabasePool(this._databaseIdentifier);
        const capturedReuseKey = pool.getConfigurationReuseKey(this._databaseConfiguration);
        const connectionReuseKey = pool.getConnectionConfigurationReuseKey(this._physicalConnection);
        if (capturedReuseKey !== this._configurationReuseKey || connectionReuseKey !== this._configurationReuseKey) {
            throw new Error(`Database operation for ${JSON.stringify(this._databaseIdentifier)} belongs to a different physical database than its captured tenant handle`);
        }
        if (this._enforceCurrentTenantReuseKey && pool.getConfigurationReuseKey() !== this._configurationReuseKey) {
            throw new Error(`Database operation for ${JSON.stringify(this._databaseIdentifier)} belongs to a different physical database than the current tenant context`);
        }
    }
    /**
     * Expires the operation and all scopes/records bound to it.
     * @returns {void}
     */
    complete() {
        this._active = false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlcmF0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RhdGFiYXNlL29wZXJhdGlvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxtQkFBbUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUUzRDs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3Qzs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLHFCQUFxQixFQUFFLHFCQUFxQixFQUFFLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSw0QkFBNEIsR0FBRyxJQUFJLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLE1BQU0sRUFBQztRQUM3SyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtRQUNuQixJQUFJLENBQUMsY0FBYyxHQUFHLGFBQWEsQ0FBQTtRQUNuQyxJQUFJLENBQUMsc0JBQXNCLEdBQUcscUJBQXFCLElBQUksYUFBYSxDQUFDLDRCQUE0QixDQUFDLGtCQUFrQixFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQzdILElBQUksQ0FBQyxzQkFBc0IsR0FBRyxxQkFBcUIsQ0FBQTtRQUNuRCxJQUFJLENBQUMsbUJBQW1CLEdBQUcsa0JBQWtCLENBQUE7UUFDN0MsSUFBSSxDQUFDLDZCQUE2QixHQUFHLDRCQUE0QixDQUFBO1FBQ2pFLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxVQUFVLENBQUE7UUFDckMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGdCQUFnQixDQUFBO1FBQ3pDLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFBO1FBQ3JCLDhHQUE4RztRQUM5RyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtRQUN2QyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksbUJBQW1CLENBQUM7WUFDekMsVUFBVTtZQUNWLFNBQVMsRUFBRSxJQUFJO1lBQ2YsS0FBSztT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SUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7WUFDMUcsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNoSyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQTtJQUN0QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IE9wZXJhdGlvbkNvbm5lY3Rpb24gZnJvbSBcIi4vb3BlcmF0aW9uLWNvbm5lY3Rpb24uanNcIlxuXG4vKipcbiAqIEV4cGxpY2l0IG93bmVyIGZvciBtb2RlbCB3b3JrIHBlcmZvcm1lZCBvbiBvbmUgcGlubmVkIHRyYW5zYWN0aW9uYWxcbiAqIGNvbm5lY3Rpb24uXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlT3BlcmF0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3BlcmF0aW9uIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuZm9yY2VDdXJyZW50VGVuYW50UmV1c2VLZXldIC0gV2hldGhlciBhbWJpZW50IHRlbmFudCBjaGFuZ2VzIGludmFsaWRhdGUgdGhpcyBsZWdhY3kgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gW2FyZ3MuZGF0YWJhc2VDb25maWd1cmF0aW9uXSAtIENhcHR1cmVkIHJlc29sdmVkIHBoeXNpY2FsIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbmZpZ3VyYXRpb25SZXVzZUtleSAtIFBoeXNpY2FsIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24ga2V5IGNhcHR1cmVkIGF0IGNoZWNrb3V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29ubmVjdGlvbiAtIFBpbm5lZCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBTaW5ndWxhciBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N5bWJvbH0gYXJncy5vd25lciAtIE9wYXF1ZSBwb29sIGxlYXNlIG93bmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc2NoZW1hR2VuZXJhdGlvbl0gLSBUZW5hbnQgc2NoZW1hIGdlbmVyYXRpb24gb3duaW5nIHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3QgfCB1bmRlZmluZWR9IGFyZ3MudGVuYW50IC0gVGVuYW50IGRlc2NyaXB0b3IgY2FwdHVyZWQgYnkgdGhlIG93bmluZyBoYW5kbGUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VDb25maWd1cmF0aW9uLCBjb25maWd1cmF0aW9uUmV1c2VLZXksIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgZW5mb3JjZUN1cnJlbnRUZW5hbnRSZXVzZUtleSA9IHRydWUsIG93bmVyLCBzY2hlbWFHZW5lcmF0aW9uLCB0ZW5hbnR9KSB7XG4gICAgdGhpcy5fYWN0aXZlID0gdHJ1ZVxuICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fZGF0YWJhc2VDb25maWd1cmF0aW9uID0gZGF0YWJhc2VDb25maWd1cmF0aW9uIHx8IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICB0aGlzLl9jb25maWd1cmF0aW9uUmV1c2VLZXkgPSBjb25maWd1cmF0aW9uUmV1c2VLZXlcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9lbmZvcmNlQ3VycmVudFRlbmFudFJldXNlS2V5ID0gZW5mb3JjZUN1cnJlbnRUZW5hbnRSZXVzZUtleVxuICAgIHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbiA9IGNvbm5lY3Rpb25cbiAgICB0aGlzLl9zY2hlbWFHZW5lcmF0aW9uID0gc2NoZW1hR2VuZXJhdGlvblxuICAgIHRoaXMuX3RlbmFudCA9IHRlbmFudFxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDx0eXBlb2YgaW1wb3J0KFwiLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgdHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX2JvdW5kTW9kZWxDbGFzc2VzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2Nvbm5lY3Rpb24gPSBuZXcgT3BlcmF0aW9uQ29ubmVjdGlvbih7XG4gICAgICBjb25uZWN0aW9uLFxuICAgICAgb3BlcmF0aW9uOiB0aGlzLFxuICAgICAgb3duZXJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gb3BlcmF0aW9uLWJvdW5kIG1vZGVsIHF1ZXJ5L2NyZWF0ZSBzY29wZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTUNcbiAgICogQHBhcmFtIHtNQ30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGJpbmQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+fSAtIE9wZXJhdGlvbi1ib3VuZCBzY29wZS5cbiAgICovXG4gIGZvck1vZGVsKE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLmFzc2VydEFjdGl2ZSgpXG4gICAgdGhpcy5hc3NlcnRNb2RlbChNb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzcyhNb2RlbENsYXNzKS5fbmV3UXVlcnkoe1xuICAgICAgZHJpdmVyOiB0aGlzLmNvbm5lY3Rpb24oKSxcbiAgICAgIG9wZXJhdGlvbjogdGhpc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIG1vZGVsLWNsYXNzIHZpZXcgd2hvc2Ugc2NoZW1hIG1ldGFkYXRhIGlzIGJvdW5kIHRvIHRoaXMgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgZ2VuZXJhdGlvbi4gQ29uc3RydWN0aW9uIHN0aWxsIHByb2R1Y2VzIHRoZSBhcHBsaWNhdGlvbidzIG9yaWdpbmFsXG4gICAqIG1vZGVsIGNsYXNzLCBzbyBsaWZlY3ljbGUgY2FsbGJhY2tzIGFuZCBtb2RlbCByZWdpc3RyaWVzIHJldGFpbiBjbGFzcyBpZGVudGl0eS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gTUNcbiAgICogQHBhcmFtIHtNQ30gTW9kZWxDbGFzcyAtIENhbm9uaWNhbCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge01DfSAtIE9wZXJhdGlvbi1ib3VuZCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIG1vZGVsQ2xhc3MoTW9kZWxDbGFzcykge1xuICAgIGlmICghdGhpcy5fc2NoZW1hR2VuZXJhdGlvbikgcmV0dXJuIE1vZGVsQ2xhc3NcblxuICAgIGNvbnN0IGNhbm9uaWNhbE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge01DfSAqLyAoTW9kZWxDbGFzcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzIHx8IE1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuX2JvdW5kTW9kZWxDbGFzc2VzLmdldChjYW5vbmljYWxNb2RlbENsYXNzKVxuXG4gICAgaWYgKGV4aXN0aW5nKSByZXR1cm4gLyoqIEB0eXBlIHtNQ30gKi8gKGV4aXN0aW5nKVxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGl0eSA9IHRoaXMuZGF0YWJhc2VJZGVudGl0eSgpXG4gICAgY29uc3QgbWV0YWRhdGFLZXkgPSBgJHtkYXRhYmFzZUlkZW50aXR5Lmxlbmd0aH06JHtkYXRhYmFzZUlkZW50aXR5fToke3RoaXMuX3NjaGVtYUdlbmVyYXRpb259YFxuICAgIGNvbnN0IG1ldGFkYXRhUHJvcGVydGllcyA9IGNhbm9uaWNhbE1vZGVsQ2xhc3MucmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzKClcbiAgICBjb25zdCBib3VuZE1vZGVsQ2xhc3MgPSBuZXcgUHJveHkoY2Fub25pY2FsTW9kZWxDbGFzcywge1xuICAgICAgY29uc3RydWN0OiAodGFyZ2V0LCBhcmdzLCBuZXdUYXJnZXQpID0+IFJlZmxlY3QuY29uc3RydWN0KHRhcmdldCwgYXJncywgbmV3VGFyZ2V0KSxcbiAgICAgIGdldDogKHRhcmdldCwgcHJvcGVydHksIHJlY2VpdmVyKSA9PiB7XG4gICAgICAgIGlmIChwcm9wZXJ0eSA9PT0gXCJfcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzXCIpIHJldHVybiB0YXJnZXRcbiAgICAgICAgaWYgKHByb3BlcnR5ID09PSBcIl9yZWNvcmRNZXRhZGF0YUJpbmRlclwiKSByZXR1cm4gKC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIHRhcmdldE1vZGVsQ2xhc3MpID0+IHRoaXMubW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgICBpZiAocHJvcGVydHkgPT09IFwiX3JlY29yZE1ldGFkYXRhT3BlcmF0aW9uXCIpIHJldHVybiB0aGlzXG4gICAgICAgIGlmICh0eXBlb2YgcHJvcGVydHkgPT09IFwic3RyaW5nXCIgJiYgbWV0YWRhdGFQcm9wZXJ0aWVzLmhhcyhwcm9wZXJ0eSkpIHJldHVybiB0YXJnZXQucmVjb3JkTWV0YWRhdGFWYWx1ZShtZXRhZGF0YUtleSwgcHJvcGVydHkpXG5cbiAgICAgICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgcHJvcGVydHksIHJlY2VpdmVyKVxuICAgICAgfSxcbiAgICAgIHNldDogKHRhcmdldCwgcHJvcGVydHksIHZhbHVlLCByZWNlaXZlcikgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIHByb3BlcnR5ID09PSBcInN0cmluZ1wiICYmIG1ldGFkYXRhUHJvcGVydGllcy5oYXMocHJvcGVydHkpKSB7XG4gICAgICAgICAgdGFyZ2V0LnNldFJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5LCB2YWx1ZSlcbiAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFJlZmxlY3Quc2V0KHRhcmdldCwgcHJvcGVydHksIHZhbHVlLCByZWNlaXZlcilcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgdGhpcy5fYm91bmRNb2RlbENsYXNzZXMuc2V0KGNhbm9uaWNhbE1vZGVsQ2xhc3MsIGJvdW5kTW9kZWxDbGFzcylcblxuICAgIHJldHVybiAvKiogQHR5cGUge01DfSAqLyAoYm91bmRNb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIHRoYXQgYSBtb2RlbCBiZWxvbmdzIHRvIHRoaXMgb3BlcmF0aW9uJ3MgY29uZmlndXJhdGlvbiBhbmQgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byB2ZXJpZnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0TW9kZWwoTW9kZWxDbGFzcykge1xuICAgIGlmIChNb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkgIT09IHRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBiZWxvbmdzIHRvIGFub3RoZXIgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb25gKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyID0gTW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudDogdGhpcy5fdGVuYW50fSlcblxuICAgIGlmIChtb2RlbERhdGFiYXNlSWRlbnRpZmllciAhPT0gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gdXNlcyBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyKX0sIG5vdCBvcGVyYXRpb24gZGF0YWJhc2UgJHtKU09OLnN0cmluZ2lmeSh0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIpfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgbG9hZGVkIG9yIGJ1aWx0IHJlY29yZCB0byB0aGlzIG9wZXJhdGlvbi5cbiAgICogQHRlbXBsYXRlIHtpbXBvcnQoXCIuL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNb2RlbFxuICAgKiBAcGFyYW0ge01vZGVsfSByZWNvcmQgLSBSZWNvcmQgdG8gYmluZC5cbiAgICogQHJldHVybnMge01vZGVsfSAtIEJvdW5kIHJlY29yZC5cbiAgICovXG4gIGJpbmRSZWNvcmQocmVjb3JkKSB7XG4gICAgdGhpcy5hc3NlcnRBY3RpdmUoKVxuICAgIHRoaXMuYXNzZXJ0TW9kZWwocmVjb3JkLmdldE1vZGVsQ2xhc3MoKSlcbiAgICByZWNvcmQuYmluZERhdGFiYXNlT3BlcmF0aW9uKHRoaXMpXG4gICAgcmVjb3JkLmNhcHR1cmVEYXRhYmFzZUlkZW50aXR5KHRoaXMuZGF0YWJhc2VJZGVudGl0eSgpKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIG93bmVkIGJ5IHRoZSBjdXJyZW50IG9wZXJhdGlvbiB0cmFuc2FjdGlvbiBmcmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVnaXN0cmF0aW9uIG9yIGV4ZWN1dGlvbi5cbiAgICovXG4gIGFzeW5jIGFmdGVyQ29tbWl0KGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnRBY3RpdmUoKVxuICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGd1YXJkIG93bmVkIGJ5IHRoZSBjdXJyZW50IHRyYW5zYWN0aW9uL3NhdmVwb2ludCBmcmFtZS5cbiAgICogQHBhcmFtIHsoY29udGV4dDoge29wZXJhdGlvbjogVmVsb2Npb3VzRGF0YWJhc2VPcGVyYXRpb259KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBHdWFyZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgYmVmb3JlQ29tbWl0KGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnRBY3RpdmUoKVxuICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmJlZm9yZUNvbW1pdCgoKSA9PiBjYWxsYmFjayh7b3BlcmF0aW9uOiB0aGlzfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIG5lc3RlZCBvcGVyYXRpb24gdHJhbnNhY3Rpb24vc2F2ZXBvaW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5hc3NlcnRBY3RpdmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRlbGliZXJhdGVseSBleHBvc2VkIG9wZXJhdGlvbiBjb25uZWN0aW9uIGZhY2FkZSBmb3IgcmF3IFNRTC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gT3BlcmF0aW9uLWJvdW5kIGNvbm5lY3Rpb24uXG4gICAqL1xuICBjb25uZWN0aW9uKCkge1xuICAgIHRoaXMuYXNzZXJ0QWN0aXZlKClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIFByb3h5IGZhY2FkZSB0byB0aGUgY29tcGxldGUgZHJpdmVyIHN1cmZhY2UgdGhhdCBpdCBmb3J3YXJkcy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH1cbiAgICAgKi9cbiAgICBjb25zdCBjb25uZWN0aW9uRmFjYWRlID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMuX2Nvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gY29ubmVjdGlvbkZhY2FkZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHRlbmFudCBkZXNjcmlwdG9yIGNhcHR1cmVkIGJ5IHRoZSBpbW11dGFibGUgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWR9IC0gQ2FwdHVyZWQgdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqL1xuICB0ZW5hbnQoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWR9ICovICh0aGlzLl90ZW5hbnQpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyIG93bmVkIGJ5IHRoaXMgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBkYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBzdGFibGUgcGh5c2ljYWwtZGF0YWJhc2UgaWRlbnRpdHkgc3VpdGFibGUgZm9yIG9wZXJhdGlvbi1hd2FyZSBjYWNoZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqL1xuICBkYXRhYmFzZUlkZW50aXR5KCkge1xuICAgIHJldHVybiBgJHt0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXJ9OiR7dGhpcy5fY29uZmlndXJhdGlvblJldXNlS2V5fWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB0ZW5hbnQgc2NoZW1hIGdlbmVyYXRpb24gY2FwdHVyZWQgd2hlbiB0aGlzIG9wZXJhdGlvbiBzdGFydGVkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENhcHR1cmVkIHNjaGVtYSBnZW5lcmF0aW9uLlxuICAgKi9cbiAgc2NoZW1hR2VuZXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hR2VuZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGEgbW9kZWwgdGhyb3VnaCB0aGlzIG9wZXJhdGlvbidzIGNhcHR1cmVkIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQoTW9kZWxDbGFzcykge1xuICAgIHRoaXMuYXNzZXJ0QWN0aXZlKClcblxuICAgIGNvbnN0IGJvdW5kTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzcyhNb2RlbENsYXNzKVxuXG4gICAgaWYgKGJvdW5kTW9kZWxDbGFzcy5pc0luaXRpYWxpemVkKCkpIHRoaXMuYXNzZXJ0TW9kZWwoTW9kZWxDbGFzcylcblxuICAgIGF3YWl0IGJvdW5kTW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCh7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9jb25maWd1cmF0aW9uLFxuICAgICAgY29ubmVjdGlvbjogdGhpcy5jb25uZWN0aW9uKClcbiAgICB9KVxuICAgIHRoaXMuYXNzZXJ0TW9kZWwoTW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlzZXMgd2hlbiBhbiBvcGVyYXRpb24gaGFuZGxlIGhhcyBsZWZ0IGl0cyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRBY3RpdmUoKSB7XG4gICAgaWYgKCF0aGlzLl9hY3RpdmUpIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIG9wZXJhdGlvbiBoYXMgY29tcGxldGVkXCIpXG5cbiAgICBjb25zdCBwb29sID0gdGhpc1xuICAgICAgLl9jb25maWd1cmF0aW9uXG4gICAgICAuZ2V0RGF0YWJhc2VQb29sKHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBjYXB0dXJlZFJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkodGhpcy5fZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25SZXVzZUtleSA9IHBvb2wuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleSh0aGlzLl9waHlzaWNhbENvbm5lY3Rpb24pXG5cbiAgICBpZiAoY2FwdHVyZWRSZXVzZUtleSAhPT0gdGhpcy5fY29uZmlndXJhdGlvblJldXNlS2V5IHx8IGNvbm5lY3Rpb25SZXVzZUtleSAhPT0gdGhpcy5fY29uZmlndXJhdGlvblJldXNlS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYERhdGFiYXNlIG9wZXJhdGlvbiBmb3IgJHtKU09OLnN0cmluZ2lmeSh0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIpfSBiZWxvbmdzIHRvIGEgZGlmZmVyZW50IHBoeXNpY2FsIGRhdGFiYXNlIHRoYW4gaXRzIGNhcHR1cmVkIHRlbmFudCBoYW5kbGVgKVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9lbmZvcmNlQ3VycmVudFRlbmFudFJldXNlS2V5ICYmIHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KCkgIT09IHRoaXMuX2NvbmZpZ3VyYXRpb25SZXVzZUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBvcGVyYXRpb24gZm9yICR7SlNPTi5zdHJpbmdpZnkodGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyKX0gYmVsb25ncyB0byBhIGRpZmZlcmVudCBwaHlzaWNhbCBkYXRhYmFzZSB0aGFuIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXhwaXJlcyB0aGUgb3BlcmF0aW9uIGFuZCBhbGwgc2NvcGVzL3JlY29yZHMgYm91bmQgdG8gaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29tcGxldGUoKSB7XG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2VcbiAgfVxufVxuIl19