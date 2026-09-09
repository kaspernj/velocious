// @ts-check
import BaseInstanceRelationship from "./base.js";
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordHasOneInstanceRelationship extends BaseInstanceRelationship {
    /**
     * Runs constructor.
     * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
     */
    constructor(args) {
        super(args);
    }
    /**
     * Loaded.
     * @type {InstanceType<TMC> | undefined} */
    _loaded = undefined;
    /**
     * Runs build.
     * @param {ConstructorParameters<TMC>[0]} data - Target model write attributes.
     * @returns {InstanceType<TMC>} - The build.
     */
    build(data) {
        const TargetModelClass = this.getBoundTargetModelClass();
        if (!TargetModelClass)
            throw new Error("Can't build a new record without a target model class");
        const newInstance = this.getModel().bindRelatedRecord(
        /** @type {InstanceType<TMC>} */ (new TargetModelClass(data)));
        this._loaded = newInstance;
        return newInstance;
    }
    async load() {
        // Force-reload: discard the cached value and fetch fresh. When the parent
        // record was loaded as part of a batch, batch the has-one lookup across
        // cohort siblings that have not preloaded this relationship yet.
        this._preloaded = false;
        this._loaded = undefined;
        const batched = await this._tryCohortPreload();
        if (batched)
            return this.loaded();
        const foreignKey = this.getForeignKey();
        const primaryKey = this.getPrimaryKey();
        const primaryModelID = /** @type {string | number} */ (this.getModel().readColumn(primaryKey));
        const TargetModelClass = /** @type {TMC} */ (this.getTargetModelClass());
        if (!TargetModelClass)
            throw new Error("Can't load without a target model class");
        /**
         * Where args.
         * @type {Record<string, string | number>} */
        const whereArgs = {};
        whereArgs[foreignKey] = primaryModelID;
        if (this.getRelationship().getPolymorphic()) {
            const typeColumn = this.getRelationship().getPolymorphicTypeColumn();
            whereArgs[typeColumn] = this.getModel().getModelClass().getModelName();
        }
        let query = this.getModel().queryForModel(TargetModelClass).where(whereArgs);
        query = this.applyScope(query);
        const foreignModel = await query.first();
        if (foreignModel) {
            this.setLoaded(foreignModel);
        }
        else {
            this.setLoaded(undefined);
        }
        this.setDirty(false);
        this.setPreloaded(true);
        return this.loaded();
    }
    /**
     * Runs loaded.
     * @returns {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} The loaded model or models (depending on relationship type)
     */
    loaded() {
        if (!this._preloaded && this.model.isPersisted()) {
            throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`);
        }
        return this._loaded;
    }
    getLoadedOrUndefined() { return this._loaded; }
    /**
     * Runs set loaded.
     * @param {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} model - Related model(s).
     */
    setLoaded(model) {
        if (Array.isArray(model))
            throw new Error(`Argument given to setLoaded was an array: ${typeof model}`);
        this._loaded = model;
    }
    getTargetModelClass() { return /** @type {TMC | undefined} */ (this.relationship.getTargetModelClass()); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFzLW9uZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtb25lLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHdCQUF3QixNQUFNLFdBQVcsQ0FBQTtBQUVoRDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8saURBQWtELFNBQVEsd0JBQXdCO0lBQ3JHOzs7T0FHRztJQUNILFlBQVksSUFBSTtRQUNkLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNiLENBQUM7SUFFRDs7K0NBRTJDO0lBQzNDLE9BQU8sR0FBRyxTQUFTLENBQUE7SUFFbkI7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxJQUFJO1FBQ1IsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtRQUV4RCxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFBO1FBRS9GLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxpQkFBaUI7UUFDbkQsZ0NBQWdDLENBQUMsQ0FBQyxJQUFJLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQzlELENBQUE7UUFFRCxJQUFJLENBQUMsT0FBTyxHQUFHLFdBQVcsQ0FBQTtRQUUxQixPQUFPLFdBQVcsQ0FBQTtJQUNwQixDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUk7UUFDUiwwRUFBMEU7UUFDMUUsd0VBQXdFO1FBQ3hFLGlFQUFpRTtRQUNqRSxJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQTtRQUN2QixJQUFJLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQTtRQUV4QixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBRTlDLElBQUksT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBRWpDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUN2QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7UUFDdkMsTUFBTSxjQUFjLEdBQUcsOEJBQThCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7UUFDOUYsTUFBTSxnQkFBZ0IsR0FBRyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLENBQUE7UUFFeEUsSUFBSSxDQUFDLGdCQUFnQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLENBQUMsQ0FBQTtRQUVqRjs7cURBRTZDO1FBQzdDLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsY0FBYyxDQUFBO1FBRXRDLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUM7WUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLHdCQUF3QixFQUFFLENBQUE7WUFFcEUsU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtRQUN4RSxDQUFDO1FBRUQsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUU1RSxLQUFLLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUU5QixNQUFNLFlBQVksR0FBRyxNQUFNLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUV4QyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pCLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDOUIsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQzNCLENBQUM7UUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3BCLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFdkIsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDakQsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLHdCQUF3QixDQUFDLENBQUE7UUFDcEgsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQTtJQUNyQixDQUFDO0lBRUQsb0JBQW9CLEtBQUssT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFBLENBQUMsQ0FBQztJQUU5Qzs7O09BR0c7SUFDSCxTQUFTLENBQUMsS0FBSztRQUNiLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxPQUFPLEtBQUssRUFBRSxDQUFDLENBQUE7UUFFdEcsSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUE7SUFDdEIsQ0FBQztJQUVELG1CQUFtQixLQUFLLE9BQU8sOEJBQThCLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQSxDQUFDLENBQUM7Q0FDMUciLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VJbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9iYXNlLmpzXCJcblxuLyoqXG4gKiBBIGdlbmVyaWMgcXVlcnkgb3ZlciBzb21lIG1vZGVsIHR5cGUuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBNQ1xuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gVE1DXG4gKiBAYXVnbWVudHMge0Jhc2VJbnN0YW5jZVJlbGF0aW9uc2hpcDxNQywgVE1DPn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRIYXNPbmVJbnN0YW5jZVJlbGF0aW9uc2hpcCBleHRlbmRzIEJhc2VJbnN0YW5jZVJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5JbnN0YW5jZVJlbGF0aW9uc2hpcHNCYXNlQXJnczxNQywgVE1DPn0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIHN1cGVyKGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogTG9hZGVkLlxuICAgKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFRNQz4gfCB1bmRlZmluZWR9ICovXG4gIF9sb2FkZWQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtDb25zdHJ1Y3RvclBhcmFtZXRlcnM8VE1DPlswXX0gZGF0YSAtIFRhcmdldCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPFRNQz59IC0gVGhlIGJ1aWxkLlxuICAgKi9cbiAgYnVpbGQoZGF0YSkge1xuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmdldEJvdW5kVGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGJ1aWxkIGEgbmV3IHJlY29yZCB3aXRob3V0IGEgdGFyZ2V0IG1vZGVsIGNsYXNzXCIpXG5cbiAgICBjb25zdCBuZXdJbnN0YW5jZSA9IHRoaXMuZ2V0TW9kZWwoKS5iaW5kUmVsYXRlZFJlY29yZChcbiAgICAgIC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFRNQz59ICovIChuZXcgVGFyZ2V0TW9kZWxDbGFzcyhkYXRhKSlcbiAgICApXG5cbiAgICB0aGlzLl9sb2FkZWQgPSBuZXdJbnN0YW5jZVxuXG4gICAgcmV0dXJuIG5ld0luc3RhbmNlXG4gIH1cblxuICBhc3luYyBsb2FkKCkge1xuICAgIC8vIEZvcmNlLXJlbG9hZDogZGlzY2FyZCB0aGUgY2FjaGVkIHZhbHVlIGFuZCBmZXRjaCBmcmVzaC4gV2hlbiB0aGUgcGFyZW50XG4gICAgLy8gcmVjb3JkIHdhcyBsb2FkZWQgYXMgcGFydCBvZiBhIGJhdGNoLCBiYXRjaCB0aGUgaGFzLW9uZSBsb29rdXAgYWNyb3NzXG4gICAgLy8gY29ob3J0IHNpYmxpbmdzIHRoYXQgaGF2ZSBub3QgcHJlbG9hZGVkIHRoaXMgcmVsYXRpb25zaGlwIHlldC5cbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZCA9IHVuZGVmaW5lZFxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMuX3RyeUNvaG9ydFByZWxvYWQoKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRQcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5TW9kZWxJRCA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGhpcy5nZXRNb2RlbCgpLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpXG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7VE1DfSAqLyAodGhpcy5nZXRUYXJnZXRNb2RlbENsYXNzKCkpXG5cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGxvYWQgd2l0aG91dCBhIHRhcmdldCBtb2RlbCBjbGFzc1wiKVxuXG4gICAgLyoqXG4gICAgICogV2hlcmUgYXJncy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gKi9cbiAgICBjb25zdCB3aGVyZUFyZ3MgPSB7fVxuXG4gICAgd2hlcmVBcmdzW2ZvcmVpZ25LZXldID0gcHJpbWFyeU1vZGVsSURcblxuICAgIGlmICh0aGlzLmdldFJlbGF0aW9uc2hpcCgpLmdldFBvbHltb3JwaGljKCkpIHtcbiAgICAgIGNvbnN0IHR5cGVDb2x1bW4gPSB0aGlzLmdldFJlbGF0aW9uc2hpcCgpLmdldFBvbHltb3JwaGljVHlwZUNvbHVtbigpXG5cbiAgICAgIHdoZXJlQXJnc1t0eXBlQ29sdW1uXSA9IHRoaXMuZ2V0TW9kZWwoKS5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICB9XG5cbiAgICBsZXQgcXVlcnkgPSB0aGlzLmdldE1vZGVsKCkucXVlcnlGb3JNb2RlbChUYXJnZXRNb2RlbENsYXNzKS53aGVyZSh3aGVyZUFyZ3MpXG5cbiAgICBxdWVyeSA9IHRoaXMuYXBwbHlTY29wZShxdWVyeSlcblxuICAgIGNvbnN0IGZvcmVpZ25Nb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgIGlmIChmb3JlaWduTW9kZWwpIHtcbiAgICAgIHRoaXMuc2V0TG9hZGVkKGZvcmVpZ25Nb2RlbClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zZXRMb2FkZWQodW5kZWZpbmVkKVxuICAgIH1cbiAgICB0aGlzLnNldERpcnR5KGZhbHNlKVxuICAgIHRoaXMuc2V0UHJlbG9hZGVkKHRydWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPFRNQz4gfCBBcnJheTxJbnN0YW5jZVR5cGU8VE1DPj4gfCB1bmRlZmluZWR9IFRoZSBsb2FkZWQgbW9kZWwgb3IgbW9kZWxzIChkZXBlbmRpbmcgb24gcmVsYXRpb25zaGlwIHR5cGUpXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQgJiYgdGhpcy5tb2RlbC5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkXG4gIH1cblxuICBnZXRMb2FkZWRPclVuZGVmaW5lZCgpIHsgcmV0dXJuIHRoaXMuX2xvYWRlZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtJbnN0YW5jZVR5cGU8VE1DPiB8IEFycmF5PEluc3RhbmNlVHlwZTxUTUM+PiB8IHVuZGVmaW5lZH0gbW9kZWwgLSBSZWxhdGVkIG1vZGVsKHMpLlxuICAgKi9cbiAgc2V0TG9hZGVkKG1vZGVsKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkobW9kZWwpKSB0aHJvdyBuZXcgRXJyb3IoYEFyZ3VtZW50IGdpdmVuIHRvIHNldExvYWRlZCB3YXMgYW4gYXJyYXk6ICR7dHlwZW9mIG1vZGVsfWApXG5cbiAgICB0aGlzLl9sb2FkZWQgPSBtb2RlbFxuICB9XG5cbiAgZ2V0VGFyZ2V0TW9kZWxDbGFzcygpIHsgcmV0dXJuIC8qKiBAdHlwZSB7VE1DIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5yZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpKSB9XG59XG4iXX0=