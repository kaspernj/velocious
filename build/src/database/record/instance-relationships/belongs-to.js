// @ts-check
import BaseInstanceRelationship from "./base.js";
import { scalarModelPrimaryKey } from "../../../utils/model-primary-key.js";
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordBelongsToInstanceRelationship extends BaseInstanceRelationship {
    /**
     * Runs constructor.
     * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
     */
    constructor(args) {
        super(args);
    }
    /**
     * Runs build.
     * @param {ConstructorParameters<TMC>[0]} data - Target model write attributes.
     * @returns {InstanceType<TMC>} - The build.
     */
    build(data) {
        const TargetModelClass = this.getBoundTargetModelClass();
        if (!TargetModelClass)
            throw new Error("Can't build a new record without a target model");
        const newInstance = this.getModel().bindRelatedRecord(
        /** @type {InstanceType<TMC>} */ (new TargetModelClass(data)));
        this._loaded = newInstance;
        return newInstance;
    }
    getLoadedOrUndefined() { return this._loaded; }
    async load() {
        // Force-reload: discard the cached value and fetch fresh. When the parent
        // record was loaded as part of a batch, batch the belongs-to lookup across
        // cohort siblings that have not preloaded this relationship yet.
        this._preloaded = false;
        this._loaded = undefined;
        const batched = await this._tryCohortPreload();
        if (batched)
            return this.loaded();
        await this._loadForeignModelOrBlank();
        this.setDirty(false);
        this.setPreloaded(true);
        return this.loaded();
    }
    /**
     * Loads the foreign model, or marks the relationship blank for empty keys.
     * @returns {Promise<void>} - Resolves after the loaded value is assigned.
     */
    async _loadForeignModelOrBlank() {
        const TargetModelClass = this._getTargetModelClassOrFail();
        const foreignModelID = this._readForeignModelID();
        if (foreignModelID === null || foreignModelID === undefined || foreignModelID === "") {
            this.setLoaded(undefined);
        }
        else {
            this.setLoaded(await this._loadForeignModel({ foreignModelID, TargetModelClass }));
        }
    }
    /**
     * Loads the related model from the foreign key value.
     * @param {object} args - Options.
     * @param {string | number | null | undefined} args.foreignModelID - Foreign model ID.
     * @param {TMC} args.TargetModelClass - Target model class.
     * @returns {Promise<InstanceType<TMC> | undefined>} - Loaded foreign model.
     */
    async _loadForeignModel({ foreignModelID, TargetModelClass }) {
        const primaryKey = scalarModelPrimaryKey(TargetModelClass.primaryKey(), `Belongs-to relationship load for ${TargetModelClass.name}`);
        /**
         * Where args.
         * @type {Record<string, string | number | null | undefined>} */
        const whereArgs = {};
        whereArgs[primaryKey] = foreignModelID;
        const query = this.applyScope(this.getModel().queryForModel(TargetModelClass).where(whereArgs));
        const foreignModel = await query.first();
        return foreignModel || undefined;
    }
    /**
     * Gets the required target model class.
     * @returns {TMC} - Target model class.
     */
    _getTargetModelClassOrFail() {
        const TargetModelClass = this.getTargetModelClass();
        if (!TargetModelClass)
            throw new Error("Can't load without a target model");
        return TargetModelClass;
    }
    /**
     * Reads the current foreign key value from the parent record.
     * @returns {string | number | null | undefined} - Foreign model ID.
     */
    _readForeignModelID() {
        return this.getModel().readColumn(this.getForeignKey());
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVsb25ncy10by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHdCQUF3QixNQUFNLFdBQVcsQ0FBQTtBQUNoRCxPQUFPLEVBQUMscUJBQXFCLEVBQUMsTUFBTSxxQ0FBcUMsQ0FBQTtBQUV6RTs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0RBQXFELFNBQVEsd0JBQXdCO0lBQ3hHOzs7T0FHRztJQUNILFlBQVksSUFBSTtRQUNkLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBRXhELElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUE7UUFFekYsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLGlCQUFpQjtRQUNuRCxnQ0FBZ0MsQ0FBQyxDQUFDLElBQUksZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FDOUQsQ0FBQTtRQUVELElBQUksQ0FBQyxPQUFPLEdBQUcsV0FBVyxDQUFBO1FBRTFCLE9BQU8sV0FBVyxDQUFBO0lBQ3BCLENBQUM7SUFFRCxvQkFBb0IsS0FBSyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUEsQ0FBQyxDQUFDO0lBRTlDLEtBQUssQ0FBQyxJQUFJO1FBQ1IsMEVBQTBFO1FBQzFFLDJFQUEyRTtRQUMzRSxpRUFBaUU7UUFDakUsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUE7UUFDdkIsSUFBSSxDQUFDLE9BQU8sR0FBRyxTQUFTLENBQUE7UUFFeEIsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUU5QyxJQUFJLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUVqQyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBQ3JDLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDcEIsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2QixPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QjtRQUM1QixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFBO1FBQzFELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBRWpELElBQUksY0FBYyxLQUFLLElBQUksSUFBSSxjQUFjLEtBQUssU0FBUyxJQUFJLGNBQWMsS0FBSyxFQUFFLEVBQUUsQ0FBQztZQUNyRixJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQzNCLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUNsRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBQztRQUN4RCxNQUFNLFVBQVUsR0FBRyxxQkFBcUIsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLEVBQUUsRUFBRSxvQ0FBb0MsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUNwSTs7d0VBRWdFO1FBQ2hFLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsY0FBYyxDQUFBO1FBRXRDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO1FBRS9GLE1BQU0sWUFBWSxHQUFHLE1BQU0sS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRXhDLE9BQU8sWUFBWSxJQUFJLFNBQVMsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMEJBQTBCO1FBQ3hCLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFbkQsSUFBSSxDQUFDLGdCQUFnQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLENBQUMsQ0FBQTtRQUUzRSxPQUFPLGdCQUFnQixDQUFBO0lBQ3pCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsT0FBTyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO0lBQ3pELENBQUM7Q0FFRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi8uLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKlxuICogQSBnZW5lcmljIHF1ZXJ5IG92ZXIgc29tZSBtb2RlbCB0eXBlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gTUNcbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IFRNQ1xuICogQGF1Z21lbnRzIHtCYXNlSW5zdGFuY2VSZWxhdGlvbnNoaXA8TUMsIFRNQz59XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAgZXh0ZW5kcyBCYXNlSW5zdGFuY2VSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuSW5zdGFuY2VSZWxhdGlvbnNoaXBzQmFzZUFyZ3M8TUMsIFRNQz59IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBzdXBlcihhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQuXG4gICAqIEBwYXJhbSB7Q29uc3RydWN0b3JQYXJhbWV0ZXJzPFRNQz5bMF19IGRhdGEgLSBUYXJnZXQgbW9kZWwgd3JpdGUgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUTUM+fSAtIFRoZSBidWlsZC5cbiAgICovXG4gIGJ1aWxkKGRhdGEpIHtcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gdGhpcy5nZXRCb3VuZFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBidWlsZCBhIG5ldyByZWNvcmQgd2l0aG91dCBhIHRhcmdldCBtb2RlbFwiKVxuXG4gICAgY29uc3QgbmV3SW5zdGFuY2UgPSB0aGlzLmdldE1vZGVsKCkuYmluZFJlbGF0ZWRSZWNvcmQoXG4gICAgICAvKiogQHR5cGUge0luc3RhbmNlVHlwZTxUTUM+fSAqLyAobmV3IFRhcmdldE1vZGVsQ2xhc3MoZGF0YSkpXG4gICAgKVxuXG4gICAgdGhpcy5fbG9hZGVkID0gbmV3SW5zdGFuY2VcblxuICAgIHJldHVybiBuZXdJbnN0YW5jZVxuICB9XG5cbiAgZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSB7IHJldHVybiB0aGlzLl9sb2FkZWQgfVxuXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgLy8gRm9yY2UtcmVsb2FkOiBkaXNjYXJkIHRoZSBjYWNoZWQgdmFsdWUgYW5kIGZldGNoIGZyZXNoLiBXaGVuIHRoZSBwYXJlbnRcbiAgICAvLyByZWNvcmQgd2FzIGxvYWRlZCBhcyBwYXJ0IG9mIGEgYmF0Y2gsIGJhdGNoIHRoZSBiZWxvbmdzLXRvIGxvb2t1cCBhY3Jvc3NcbiAgICAvLyBjb2hvcnQgc2libGluZ3MgdGhhdCBoYXZlIG5vdCBwcmVsb2FkZWQgdGhpcyByZWxhdGlvbnNoaXAgeWV0LlxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkID0gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZCgpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMuX2xvYWRGb3JlaWduTW9kZWxPckJsYW5rKClcbiAgICB0aGlzLnNldERpcnR5KGZhbHNlKVxuICAgIHRoaXMuc2V0UHJlbG9hZGVkKHRydWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBmb3JlaWduIG1vZGVsLCBvciBtYXJrcyB0aGUgcmVsYXRpb25zaGlwIGJsYW5rIGZvciBlbXB0eSBrZXlzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgbG9hZGVkIHZhbHVlIGlzIGFzc2lnbmVkLlxuICAgKi9cbiAgYXN5bmMgX2xvYWRGb3JlaWduTW9kZWxPckJsYW5rKCkge1xuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLl9nZXRUYXJnZXRNb2RlbENsYXNzT3JGYWlsKClcbiAgICBjb25zdCBmb3JlaWduTW9kZWxJRCA9IHRoaXMuX3JlYWRGb3JlaWduTW9kZWxJRCgpXG5cbiAgICBpZiAoZm9yZWlnbk1vZGVsSUQgPT09IG51bGwgfHwgZm9yZWlnbk1vZGVsSUQgPT09IHVuZGVmaW5lZCB8fCBmb3JlaWduTW9kZWxJRCA9PT0gXCJcIikge1xuICAgICAgdGhpcy5zZXRMb2FkZWQodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnNldExvYWRlZChhd2FpdCB0aGlzLl9sb2FkRm9yZWlnbk1vZGVsKHtmb3JlaWduTW9kZWxJRCwgVGFyZ2V0TW9kZWxDbGFzc30pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgcmVsYXRlZCBtb2RlbCBmcm9tIHRoZSBmb3JlaWduIGtleSB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuZm9yZWlnbk1vZGVsSUQgLSBGb3JlaWduIG1vZGVsIElELlxuICAgKiBAcGFyYW0ge1RNQ30gYXJncy5UYXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VE1DPiB8IHVuZGVmaW5lZD59IC0gTG9hZGVkIGZvcmVpZ24gbW9kZWwuXG4gICAqL1xuICBhc3luYyBfbG9hZEZvcmVpZ25Nb2RlbCh7Zm9yZWlnbk1vZGVsSUQsIFRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShUYXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYEJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIGxvYWQgZm9yICR7VGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgLyoqXG4gICAgICogV2hlcmUgYXJncy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZD59ICovXG4gICAgY29uc3Qgd2hlcmVBcmdzID0ge31cblxuICAgIHdoZXJlQXJnc1twcmltYXJ5S2V5XSA9IGZvcmVpZ25Nb2RlbElEXG5cbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuYXBwbHlTY29wZSh0aGlzLmdldE1vZGVsKCkucXVlcnlGb3JNb2RlbChUYXJnZXRNb2RlbENsYXNzKS53aGVyZSh3aGVyZUFyZ3MpKVxuXG4gICAgY29uc3QgZm9yZWlnbk1vZGVsID0gYXdhaXQgcXVlcnkuZmlyc3QoKVxuXG4gICAgcmV0dXJuIGZvcmVpZ25Nb2RlbCB8fCB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSByZXF1aXJlZCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtUTUN9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgX2dldFRhcmdldE1vZGVsQ2xhc3NPckZhaWwoKSB7XG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGxvYWQgd2l0aG91dCBhIHRhcmdldCBtb2RlbFwiKVxuXG4gICAgcmV0dXJuIFRhcmdldE1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgY3VycmVudCBmb3JlaWduIGtleSB2YWx1ZSBmcm9tIHRoZSBwYXJlbnQgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBGb3JlaWduIG1vZGVsIElELlxuICAgKi9cbiAgX3JlYWRGb3JlaWduTW9kZWxJRCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbCgpLnJlYWRDb2x1bW4odGhpcy5nZXRGb3JlaWduS2V5KCkpXG4gIH1cblxufVxuIl19