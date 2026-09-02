// @ts-check
import TenantHandle from "./tenant-handle.js";
/**
 * Model query/create scope bound to one immutable tenant handle.
 * @template {typeof import("../database/record/index.js").default} MC
 */
export default class TenantModelScope {
    /**
     * Runs constructor.
     * @param {object} args - Scope arguments.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {MC} args.modelClass - Model class to bind.
     * @param {object} args.tenant - Ordinary or null-prototype JSON-compatible tenant descriptor.
     */
    constructor({ configuration, modelClass, tenant }) {
        this._handle = new TenantHandle({ configuration, tenant });
        this._modelClass = modelClass;
        this._databaseIdentifier = modelClass.getDatabaseIdentifier({ tenant });
        Object.freeze(this);
    }
    /**
     * Runs a general model query/write callback on the captured physical tenant.
     * The query and every record/association it loads are owned by the operation
     * and must be used inside the callback.
     * @template T
     * @param {(query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>} callback - Bound model callback.
     * @returns {Promise<T>} - Callback result.
     */
    async databaseOperation(callback) {
        return await this._handle.databaseOperation({
            databaseIdentifier: this._databaseIdentifier,
            name: `usingTenant: ${this._modelClass.getModelName()}`
        }, async (operation) => {
            await operation.ensureModelInitialized(this._modelClass);
            return await callback(operation.forModel(this._modelClass), operation);
        });
    }
    /**
     * Runs a model callback in a transaction on the captured physical tenant.
     * @template T
     * @param {(query: import("../database/query/model-class-query.js").default<MC>, operation: import("../database/operation.js").default) => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    async transaction(callback) {
        return await this._handle.transaction({
            databaseIdentifier: this._databaseIdentifier,
            name: `usingTenant transaction: ${this._modelClass.getModelName()}`
        }, async (operation) => {
            await operation.ensureModelInitialized(this._modelClass);
            return await callback(operation.forModel(this._modelClass), operation);
        });
    }
    /**
     * Creates a record on the captured tenant.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Create attributes.
     * @returns {Promise<InstanceType<MC>>} - Created record.
     */
    async create(attributes = {}) {
        return await this.databaseOperation(async (query, operation) => {
            const record = await query.create(attributes);
            return record.releaseDatabaseOperation(operation);
        });
    }
    /**
     * Counts records on the captured tenant.
     * @returns {Promise<number>} - Count on the captured tenant.
     */
    async count() {
        return await this.databaseOperation(async (query) => await query.count());
    }
    /**
     * Finds a record by primary key on the captured tenant.
     * @param {string | number} recordId - Record identifier.
     * @returns {Promise<InstanceType<MC> | null>} - Found record.
     */
    async find(recordId) {
        return await this.databaseOperation(async (query, operation) => {
            const record = await query.find(recordId);
            return record ? record.releaseDatabaseOperation(operation) : null;
        });
    }
    /**
     * Finds a record by conditions on the captured tenant.
     * @param {Record<string, string | number>} conditions - Finder conditions.
     * @returns {Promise<InstanceType<MC> | null>} - Found record.
     */
    async findBy(conditions) {
        return await this.databaseOperation(async (query, operation) => {
            const record = await query.findBy(conditions);
            return record ? record.releaseDatabaseOperation(operation) : null;
        });
    }
    /**
     * Finds a record by conditions or raises on the captured tenant.
     * @param {Record<string, string | number>} conditions - Finder conditions.
     * @returns {Promise<InstanceType<MC>>} - Found record.
     */
    async findByOrFail(conditions) {
        return await this.databaseOperation(async (query, operation) => {
            const record = await query.findByOrFail(conditions);
            return record.releaseDatabaseOperation(operation);
        });
    }
    /**
     * Loads all records on the captured tenant.
     * @returns {Promise<InstanceType<MC>[]>} - All records on the captured tenant.
     */
    async toArray() {
        return await this.databaseOperation(async (query, operation) => {
            const records = await query.toArray();
            return records.map((record) => record.releaseDatabaseOperation(operation));
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LW1vZGVsLXNjb3BlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3RlbmFudHMvdGVuYW50LW1vZGVsLXNjb3BlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUU3Qzs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFnQjtJQUNuQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUM7UUFDN0MsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLFlBQVksQ0FBQyxFQUFDLGFBQWEsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBQ3hELElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFBO1FBQzdCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxVQUFVLENBQUMscUJBQXFCLENBQUMsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBRXJFLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsUUFBUTtRQUM5QixPQUFPLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztZQUMxQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsbUJBQW1CO1lBQzVDLElBQUksRUFBRSxnQkFBZ0IsSUFBSSxDQUFDLFdBQVcsQ0FBQyxZQUFZLEVBQUUsRUFBRTtTQUN4RCxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsRUFBRTtZQUNyQixNQUFNLFNBQVMsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7WUFFeEQsT0FBTyxNQUFNLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUN4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R0FBRyxNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUVyQyxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO1FBQzVFLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBUZW5hbnRIYW5kbGUgZnJvbSBcIi4vdGVuYW50LWhhbmRsZS5qc1wiXG5cbi8qKlxuICogTW9kZWwgcXVlcnkvY3JlYXRlIHNjb3BlIGJvdW5kIHRvIG9uZSBpbW11dGFibGUgdGVuYW50IGhhbmRsZS5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBNQ1xuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUZW5hbnRNb2RlbFNjb3BlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7TUN9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGJpbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzLnRlbmFudCAtIE9yZGluYXJ5IG9yIG51bGwtcHJvdG90eXBlIEpTT04tY29tcGF0aWJsZSB0ZW5hbnQgZGVzY3JpcHRvci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBtb2RlbENsYXNzLCB0ZW5hbnR9KSB7XG4gICAgdGhpcy5faGFuZGxlID0gbmV3IFRlbmFudEhhbmRsZSh7Y29uZmlndXJhdGlvbiwgdGVuYW50fSlcbiAgICB0aGlzLl9tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHt0ZW5hbnR9KVxuXG4gICAgT2JqZWN0LmZyZWV6ZSh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBnZW5lcmFsIG1vZGVsIHF1ZXJ5L3dyaXRlIGNhbGxiYWNrIG9uIHRoZSBjYXB0dXJlZCBwaHlzaWNhbCB0ZW5hbnQuXG4gICAqIFRoZSBxdWVyeSBhbmQgZXZlcnkgcmVjb3JkL2Fzc29jaWF0aW9uIGl0IGxvYWRzIGFyZSBvd25lZCBieSB0aGUgb3BlcmF0aW9uXG4gICAqIGFuZCBtdXN0IGJlIHVzZWQgaW5zaWRlIHRoZSBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsocXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+LCBvcGVyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEJvdW5kIG1vZGVsIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkYXRhYmFzZU9wZXJhdGlvbihjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9oYW5kbGUuZGF0YWJhc2VPcGVyYXRpb24oe1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBuYW1lOiBgdXNpbmdUZW5hbnQ6ICR7dGhpcy5fbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5fbW9kZWxDbGFzcylcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLl9tb2RlbENsYXNzKSwgb3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIG1vZGVsIGNhbGxiYWNrIGluIGEgdHJhbnNhY3Rpb24gb24gdGhlIGNhcHR1cmVkIHBoeXNpY2FsIHRlbmFudC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsocXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+LCBvcGVyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyB0cmFuc2FjdGlvbihjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9oYW5kbGUudHJhbnNhY3Rpb24oe1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBuYW1lOiBgdXNpbmdUZW5hbnQgdHJhbnNhY3Rpb246ICR7dGhpcy5fbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgb3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQodGhpcy5fbW9kZWxDbGFzcylcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbi5mb3JNb2RlbCh0aGlzLl9tb2RlbENsYXNzKSwgb3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJlY29yZCBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2F0dHJpYnV0ZXNdIC0gQ3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIENyZWF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRhdGFiYXNlT3BlcmF0aW9uKGFzeW5jIChxdWVyeSwgb3BlcmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBxdWVyeS5jcmVhdGUoYXR0cmlidXRlcylcblxuICAgICAgcmV0dXJuIHJlY29yZC5yZWxlYXNlRGF0YWJhc2VPcGVyYXRpb24ob3BlcmF0aW9uKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIHJlY29yZHMgb24gdGhlIGNhcHR1cmVkIHRlbmFudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBDb3VudCBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5KSA9PiBhd2FpdCBxdWVyeS5jb3VudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgcmVjb3JkIGJ5IHByaW1hcnkga2V5IG9uIHRoZSBjYXB0dXJlZCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSByZWNvcmRJZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gRm91bmQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgZmluZChyZWNvcmRJZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRhdGFiYXNlT3BlcmF0aW9uKGFzeW5jIChxdWVyeSwgb3BlcmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBxdWVyeS5maW5kKHJlY29yZElkKVxuXG4gICAgICByZXR1cm4gcmVjb3JkID8gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSByZWNvcmQgYnkgY29uZGl0aW9ucyBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGNvbmRpdGlvbnMgLSBGaW5kZXIgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIEZvdW5kIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5LCBvcGVyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgICByZXR1cm4gcmVjb3JkID8gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSByZWNvcmQgYnkgY29uZGl0aW9ucyBvciByYWlzZXMgb24gdGhlIGNhcHR1cmVkIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBjb25kaXRpb25zIC0gRmluZGVyIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIEZvdW5kIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5LCBvcGVyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHF1ZXJ5LmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuXG4gICAgICByZXR1cm4gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbGwgcmVjb3JkcyBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+W10+fSAtIEFsbCByZWNvcmRzIG9uIHRoZSBjYXB0dXJlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRhdGFiYXNlT3BlcmF0aW9uKGFzeW5jIChxdWVyeSwgb3BlcmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgcXVlcnkudG9BcnJheSgpXG5cbiAgICAgIHJldHVybiByZWNvcmRzLm1hcCgocmVjb3JkKSA9PiByZWNvcmQucmVsZWFzZURhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikpXG4gICAgfSlcbiAgfVxufVxuIl19