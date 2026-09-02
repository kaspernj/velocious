// @ts-check
import BaseInstanceRelationship from "./base.js";
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
        const primaryKey = TargetModelClass.primaryKey();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVsb25ncy10by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHdCQUF3QixNQUFNLFdBQVcsQ0FBQTtBQUVoRDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0RBQXFELFNBQVEsd0JBQXdCO0lBQ3hHOzs7T0FHRztJQUNILFlBQVksSUFBSTtRQUNkLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBRXhELElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUE7UUFFekYsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLGlCQUFpQjtRQUNuRCxnQ0FBZ0MsQ0FBQyxDQUFDLElBQUksZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FDOUQsQ0FBQTtRQUVELElBQUksQ0FBQyxPQUFPLEdBQUcsV0FBVyxDQUFBO1FBRTFCLE9BQU8sV0FBVyxDQUFBO0lBQ3BCLENBQUM7SUFFRCxvQkFBb0IsS0FBSyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUEsQ0FBQyxDQUFDO0lBRTlDLEtBQUssQ0FBQyxJQUFJO1FBQ1IsMEVBQTBFO1FBQzFFLDJFQUEyRTtRQUMzRSxpRUFBaUU7UUFDakUsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUE7UUFDdkIsSUFBSSxDQUFDLE9BQU8sR0FBRyxTQUFTLENBQUE7UUFFeEIsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUU5QyxJQUFJLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUVqQyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBQ3JDLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDcEIsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUV2QixPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QjtRQUM1QixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFBO1FBQzFELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBRWpELElBQUksY0FBYyxLQUFLLElBQUksSUFBSSxjQUFjLEtBQUssU0FBUyxJQUFJLGNBQWMsS0FBSyxFQUFFLEVBQUUsQ0FBQztZQUNyRixJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQzNCLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUNsRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBQztRQUN4RCxNQUFNLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNoRDs7d0VBRWdFO1FBQ2hFLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsY0FBYyxDQUFBO1FBRXRDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO1FBRS9GLE1BQU0sWUFBWSxHQUFHLE1BQU0sS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRXhDLE9BQU8sWUFBWSxJQUFJLFNBQVMsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsMEJBQTBCO1FBQ3hCLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFbkQsSUFBSSxDQUFDLGdCQUFnQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLENBQUMsQ0FBQTtRQUUzRSxPQUFPLGdCQUFnQixDQUFBO0lBQ3pCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsT0FBTyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO0lBQ3pELENBQUM7Q0FFRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2Jhc2UuanNcIlxuXG4vKipcbiAqIEEgZ2VuZXJpYyBxdWVyeSBvdmVyIHNvbWUgbW9kZWwgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1DXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBUTUNcbiAqIEBhdWdtZW50cyB7QmFzZUluc3RhbmNlUmVsYXRpb25zaGlwPE1DLCBUTUM+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZEJlbG9uZ3NUb0luc3RhbmNlUmVsYXRpb25zaGlwIGV4dGVuZHMgQmFzZUluc3RhbmNlUmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkluc3RhbmNlUmVsYXRpb25zaGlwc0Jhc2VBcmdzPE1DLCBUTUM+fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzKSB7XG4gICAgc3VwZXIoYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge0NvbnN0cnVjdG9yUGFyYW1ldGVyczxUTUM+WzBdfSBkYXRhIC0gVGFyZ2V0IG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtJbnN0YW5jZVR5cGU8VE1DPn0gLSBUaGUgYnVpbGQuXG4gICAqL1xuICBidWlsZChkYXRhKSB7XG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZ2V0Qm91bmRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghVGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgYnVpbGQgYSBuZXcgcmVjb3JkIHdpdGhvdXQgYSB0YXJnZXQgbW9kZWxcIilcblxuICAgIGNvbnN0IG5ld0luc3RhbmNlID0gdGhpcy5nZXRNb2RlbCgpLmJpbmRSZWxhdGVkUmVjb3JkKFxuICAgICAgLyoqIEB0eXBlIHtJbnN0YW5jZVR5cGU8VE1DPn0gKi8gKG5ldyBUYXJnZXRNb2RlbENsYXNzKGRhdGEpKVxuICAgIClcblxuICAgIHRoaXMuX2xvYWRlZCA9IG5ld0luc3RhbmNlXG5cbiAgICByZXR1cm4gbmV3SW5zdGFuY2VcbiAgfVxuXG4gIGdldExvYWRlZE9yVW5kZWZpbmVkKCkgeyByZXR1cm4gdGhpcy5fbG9hZGVkIH1cblxuICBhc3luYyBsb2FkKCkge1xuICAgIC8vIEZvcmNlLXJlbG9hZDogZGlzY2FyZCB0aGUgY2FjaGVkIHZhbHVlIGFuZCBmZXRjaCBmcmVzaC4gV2hlbiB0aGUgcGFyZW50XG4gICAgLy8gcmVjb3JkIHdhcyBsb2FkZWQgYXMgcGFydCBvZiBhIGJhdGNoLCBiYXRjaCB0aGUgYmVsb25ncy10byBsb29rdXAgYWNyb3NzXG4gICAgLy8gY29ob3J0IHNpYmxpbmdzIHRoYXQgaGF2ZSBub3QgcHJlbG9hZGVkIHRoaXMgcmVsYXRpb25zaGlwIHlldC5cbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZCA9IHVuZGVmaW5lZFxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMuX3RyeUNvaG9ydFByZWxvYWQoKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBhd2FpdCB0aGlzLl9sb2FkRm9yZWlnbk1vZGVsT3JCbGFuaygpXG4gICAgdGhpcy5zZXREaXJ0eShmYWxzZSlcbiAgICB0aGlzLnNldFByZWxvYWRlZCh0cnVlKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZm9yZWlnbiBtb2RlbCwgb3IgbWFya3MgdGhlIHJlbGF0aW9uc2hpcCBibGFuayBmb3IgZW1wdHkga2V5cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGxvYWRlZCB2YWx1ZSBpcyBhc3NpZ25lZC5cbiAgICovXG4gIGFzeW5jIF9sb2FkRm9yZWlnbk1vZGVsT3JCbGFuaygpIHtcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gdGhpcy5fZ2V0VGFyZ2V0TW9kZWxDbGFzc09yRmFpbCgpXG4gICAgY29uc3QgZm9yZWlnbk1vZGVsSUQgPSB0aGlzLl9yZWFkRm9yZWlnbk1vZGVsSUQoKVxuXG4gICAgaWYgKGZvcmVpZ25Nb2RlbElEID09PSBudWxsIHx8IGZvcmVpZ25Nb2RlbElEID09PSB1bmRlZmluZWQgfHwgZm9yZWlnbk1vZGVsSUQgPT09IFwiXCIpIHtcbiAgICAgIHRoaXMuc2V0TG9hZGVkKHVuZGVmaW5lZClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zZXRMb2FkZWQoYXdhaXQgdGhpcy5fbG9hZEZvcmVpZ25Nb2RlbCh7Zm9yZWlnbk1vZGVsSUQsIFRhcmdldE1vZGVsQ2xhc3N9KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIHJlbGF0ZWQgbW9kZWwgZnJvbSB0aGUgZm9yZWlnbiBrZXkgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmZvcmVpZ25Nb2RlbElEIC0gRm9yZWlnbiBtb2RlbCBJRC5cbiAgICogQHBhcmFtIHtUTUN9IGFyZ3MuVGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFRNQz4gfCB1bmRlZmluZWQ+fSAtIExvYWRlZCBmb3JlaWduIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgX2xvYWRGb3JlaWduTW9kZWwoe2ZvcmVpZ25Nb2RlbElELCBUYXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBUYXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIC8qKlxuICAgICAqIFdoZXJlIGFyZ3MuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+fSAqL1xuICAgIGNvbnN0IHdoZXJlQXJncyA9IHt9XG5cbiAgICB3aGVyZUFyZ3NbcHJpbWFyeUtleV0gPSBmb3JlaWduTW9kZWxJRFxuXG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLmFwcGx5U2NvcGUodGhpcy5nZXRNb2RlbCgpLnF1ZXJ5Rm9yTW9kZWwoVGFyZ2V0TW9kZWxDbGFzcykud2hlcmUod2hlcmVBcmdzKSlcblxuICAgIGNvbnN0IGZvcmVpZ25Nb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgIHJldHVybiBmb3JlaWduTW9kZWwgfHwgdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgcmVxdWlyZWQgdGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VE1DfSAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIF9nZXRUYXJnZXRNb2RlbENsYXNzT3JGYWlsKCkge1xuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBsb2FkIHdpdGhvdXQgYSB0YXJnZXQgbW9kZWxcIilcblxuICAgIHJldHVybiBUYXJnZXRNb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGN1cnJlbnQgZm9yZWlnbiBrZXkgdmFsdWUgZnJvbSB0aGUgcGFyZW50IHJlY29yZC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IC0gRm9yZWlnbiBtb2RlbCBJRC5cbiAgICovXG4gIF9yZWFkRm9yZWlnbk1vZGVsSUQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWwoKS5yZWFkQ29sdW1uKHRoaXMuZ2V0Rm9yZWlnbktleSgpKVxuICB9XG5cbn1cbiJdfQ==