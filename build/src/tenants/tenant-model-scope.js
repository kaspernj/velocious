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
     * @param {string | null} [column] - Attribute or column to count. Defaults to the primary key.
     * @returns {Promise<number>} - Count on the captured tenant.
     */
    async count(column = null) {
        return await this.databaseOperation(async (query) => await query.count(column));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuYW50LW1vZGVsLXNjb3BlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3RlbmFudHMvdGVuYW50LW1vZGVsLXNjb3BlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUU3Qzs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFnQjtJQUNuQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUM7UUFDN0MsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLFlBQVksQ0FBQyxFQUFDLGFBQWEsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBQ3hELElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFBO1FBQzdCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxVQUFVLENBQUMscUJBQXFCLENBQUMsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBRXJFLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsUUFBUTtRQUM5QixPQUFPLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztZQUMxQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsbUJBQW1CO1lBQzVDLElBQUksRUFBRSxnQkFBZ0IsSUFBSSxDQUFDLFdBQVcsQ0FBQyxZQUFZLEVBQUUsRUFBRTtTQUN4RCxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsRUFBRTtZQUNyQixNQUFNLFNBQVMsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7WUFFeEQsT0FBTyxNQUFNLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUN4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LFNBQVMsRUFBRSxFQUFFO1lBQzdELE1BQU0sT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBRXJDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLHdCQUF3QixDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7UUFDNUUsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFRlbmFudEhhbmRsZSBmcm9tIFwiLi90ZW5hbnQtaGFuZGxlLmpzXCJcblxuLyoqXG4gKiBNb2RlbCBxdWVyeS9jcmVhdGUgc2NvcGUgYm91bmQgdG8gb25lIGltbXV0YWJsZSB0ZW5hbnQgaGFuZGxlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1DXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlbmFudE1vZGVsU2NvcGUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTY29wZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPd25pbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtNQ30gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gYmluZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MudGVuYW50IC0gT3JkaW5hcnkgb3IgbnVsbC1wcm90b3R5cGUgSlNPTi1jb21wYXRpYmxlIHRlbmFudCBkZXNjcmlwdG9yLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIG1vZGVsQ2xhc3MsIHRlbmFudH0pIHtcbiAgICB0aGlzLl9oYW5kbGUgPSBuZXcgVGVuYW50SGFuZGxlKHtjb25maWd1cmF0aW9uLCB0ZW5hbnR9KVxuICAgIHRoaXMuX21vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe3RlbmFudH0pXG5cbiAgICBPYmplY3QuZnJlZXplKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGdlbmVyYWwgbW9kZWwgcXVlcnkvd3JpdGUgY2FsbGJhY2sgb24gdGhlIGNhcHR1cmVkIHBoeXNpY2FsIHRlbmFudC5cbiAgICogVGhlIHF1ZXJ5IGFuZCBldmVyeSByZWNvcmQvYXNzb2NpYXRpb24gaXQgbG9hZHMgYXJlIG93bmVkIGJ5IHRoZSBvcGVyYXRpb25cbiAgICogYW5kIG11c3QgYmUgdXNlZCBpbnNpZGUgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxNQz4sIG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQm91bmQgbW9kZWwgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGRhdGFiYXNlT3BlcmF0aW9uKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2hhbmRsZS5kYXRhYmFzZU9wZXJhdGlvbih7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIG5hbWU6IGB1c2luZ1RlbmFudDogJHt0aGlzLl9tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWBcbiAgICB9LCBhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICBhd2FpdCBvcGVyYXRpb24uZW5zdXJlTW9kZWxJbml0aWFsaXplZCh0aGlzLl9tb2RlbENsYXNzKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uLmZvck1vZGVsKHRoaXMuX21vZGVsQ2xhc3MpLCBvcGVyYXRpb24pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgbW9kZWwgY2FsbGJhY2sgaW4gYSB0cmFuc2FjdGlvbiBvbiB0aGUgY2FwdHVyZWQgcGh5c2ljYWwgdGVuYW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxNQz4sIG9wZXJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2hhbmRsZS50cmFuc2FjdGlvbih7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgIG5hbWU6IGB1c2luZ1RlbmFudCB0cmFuc2FjdGlvbjogJHt0aGlzLl9tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWBcbiAgICB9LCBhc3luYyAob3BlcmF0aW9uKSA9PiB7XG4gICAgICBhd2FpdCBvcGVyYXRpb24uZW5zdXJlTW9kZWxJbml0aWFsaXplZCh0aGlzLl9tb2RlbENsYXNzKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uLmZvck1vZGVsKHRoaXMuX21vZGVsQ2xhc3MpLCBvcGVyYXRpb24pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmVjb3JkIG9uIHRoZSBjYXB0dXJlZCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXR0cmlidXRlc10gLSBDcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gQ3JlYXRlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoYXR0cmlidXRlcyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5LCBvcGVyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHF1ZXJ5LmNyZWF0ZShhdHRyaWJ1dGVzKVxuXG4gICAgICByZXR1cm4gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgcmVjb3JkcyBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFtjb2x1bW5dIC0gQXR0cmlidXRlIG9yIGNvbHVtbiB0byBjb3VudC4gRGVmYXVsdHMgdG8gdGhlIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIENvdW50IG9uIHRoZSBjYXB0dXJlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyBjb3VudChjb2x1bW4gPSBudWxsKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5KSA9PiBhd2FpdCBxdWVyeS5jb3VudChjb2x1bW4pKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgcmVjb3JkIGJ5IHByaW1hcnkga2V5IG9uIHRoZSBjYXB0dXJlZCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSByZWNvcmRJZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gRm91bmQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgZmluZChyZWNvcmRJZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRhdGFiYXNlT3BlcmF0aW9uKGFzeW5jIChxdWVyeSwgb3BlcmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBxdWVyeS5maW5kKHJlY29yZElkKVxuXG4gICAgICByZXR1cm4gcmVjb3JkID8gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSByZWNvcmQgYnkgY29uZGl0aW9ucyBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGNvbmRpdGlvbnMgLSBGaW5kZXIgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIEZvdW5kIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5LCBvcGVyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgICByZXR1cm4gcmVjb3JkID8gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSByZWNvcmQgYnkgY29uZGl0aW9ucyBvciByYWlzZXMgb24gdGhlIGNhcHR1cmVkIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBjb25kaXRpb25zIC0gRmluZGVyIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIEZvdW5kIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGF0YWJhc2VPcGVyYXRpb24oYXN5bmMgKHF1ZXJ5LCBvcGVyYXRpb24pID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHF1ZXJ5LmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuXG4gICAgICByZXR1cm4gcmVjb3JkLnJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbGwgcmVjb3JkcyBvbiB0aGUgY2FwdHVyZWQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+W10+fSAtIEFsbCByZWNvcmRzIG9uIHRoZSBjYXB0dXJlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRhdGFiYXNlT3BlcmF0aW9uKGFzeW5jIChxdWVyeSwgb3BlcmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgcXVlcnkudG9BcnJheSgpXG5cbiAgICAgIHJldHVybiByZWNvcmRzLm1hcCgocmVjb3JkKSA9PiByZWNvcmQucmVsZWFzZURhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikpXG4gICAgfSlcbiAgfVxufVxuIl19