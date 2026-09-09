// @ts-check
import BelongsToPreloader from "../../query/preloader/belongs-to.js";
import HasManyPreloader from "../../query/preloader/has-many.js";
import HasOnePreloader from "../../query/preloader/has-one.js";
/**
 * InstanceRelationshipsBaseArgs type.
 * @template {typeof import("../index.js").default} [MC=typeof import("../index.js").default]
 * @template {typeof import("../index.js").default} [TMC=typeof import("../index.js").default]
 * @typedef {object} InstanceRelationshipsBaseArgs
 * @property {InstanceType<MC>} model - Parent model instance.
 * @property {import("../relationships/base.js").default} relationship - Relationship metadata definition.
 */
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} [MC=typeof import("../index.js").default]
 * @template {typeof import("../index.js").default} [TMC=typeof import("../index.js").default]
 */
export default class VelociousDatabaseRecordBaseInstanceRelationship {
    /**
     * Auto save.
     * @type {boolean | undefined} */
    _autoSave = undefined;
    /**
     * Preloaded.
     * @type {boolean | undefined} */
    _preloaded = undefined;
    /**
     * Loaded.
     * @type {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} */
    _loaded = undefined;
    /**
     * Runs constructor.
     * @param {InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
     */
    constructor({ model, relationship }) {
        this._dirty = false;
        this.model = model;
        this.relationship = relationship;
    }
    /**
     * Runs add to loaded.
     * @abstract
     * @param {InstanceType<TMC>[] | InstanceType<TMC>} models - Model instances.
     * @returns {void} - No return value.
     */
    addToLoaded(models) {
        throw new Error("addToLoaded not implemented");
    }
    /**
     * Runs build.
     * @abstract
     * @param {ConstructorParameters<TMC>[0]} attributes - Target model write attributes.
     * @returns {InstanceType<TMC>} - The build.
     */
    build(attributes) {
        throw new Error("'build' not implemented");
    }
    /**
     * Resolves a relationship target through the source record's operation and
     * metadata generation before construction.
     * @returns {TMC | undefined} - Bound target model class.
     */
    getBoundTargetModelClass() {
        const targetModelClass = this.getTargetModelClass();
        if (!targetModelClass)
            return undefined;
        return /** @type {TMC} */ (this.getModel().getModelClass().bindRecordMetadataModelClass(targetModelClass));
    }
    /**
     * Runs get auto save.
     * @returns {boolean | undefined} Whether the relationship should be auto-saved before saving the parent model
     */
    getAutoSave() { return this._autoSave; }
    /**
     * Runs set auto save.
     * @param {boolean} newAutoSaveValue Whether the relationship should be auto-saved before saving the parent model
     * @returns {void} - No return value.
     */
    setAutoSave(newAutoSaveValue) { this._autoSave = newAutoSaveValue; }
    /**
     * Runs set dirty.
     * @param {boolean} newValue Whether the relationship is dirty (has been modified)
     * @returns {void} - No return value.
     */
    setDirty(newValue) { this._dirty = newValue; }
    /**
     * Runs get dirty.
     * @returns {boolean} Whether the relationship is dirty (has been modified)
     */
    getDirty() { return this._dirty; }
    /**
     * Runs load.
     * @abstract
     * @returns {Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>} - Resolves with loaded relationship value.
     */
    load() {
        throw new Error("'load' not implemented");
    }
    /**
     * Loads the relationship if not already loaded. When the parent record was
     * loaded as part of a batch (cohort) and autoload is enabled, siblings in
     * the cohort that share this relationship and have not preloaded it yet
     * are batched into a single query via the existing preloader path.
     * @returns {Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>} - Resolves with loaded relationship value.
     */
    async autoloadOrLoad() {
        if (this._loaded !== undefined)
            return this._loaded;
        const batched = await this._tryCohortPreload();
        if (!batched)
            await this.load();
        return this._loaded;
    }
    /**
     * Attempts to batch-load this relationship across cohort siblings via the
     * existing preloader path. Returns true when a batch ran (self is always
     * included because callers reset their own `_preloaded` state before
     * calling), false when autoload is off, there is no cohort, or no batch
     * candidates remain. Siblings that have already preloaded this relationship
     * are skipped so their cached value is preserved.
     * @returns {Promise<boolean>} - Whether a cohort batch preload ran.
     */
    async _tryCohortPreload() {
        const relationshipDef = this.getRelationship();
        const configuration = relationshipDef.getConfiguration();
        const cohort = /** @type {Array<import("../index.js").default> | undefined} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this.model)._loadCohort);
        if (!configuration.getAutoload() || !relationshipDef.getAutoload() || !cohort || cohort.length <= 1) {
            return false;
        }
        const relationshipName = relationshipDef.getRelationshipName();
        const OwnerModelClass = /** @type {ReturnType<typeof JSON.parse>} */ (this.model).constructor;
        /**
         * Batch.
         * @type {Array<import("../index.js").default>} */
        const batch = [];
        // Exact same class, persisted, no existing in-memory relationship state.
        // Skip siblings where `_loaded` is already set — they may have been
        // preloaded (preserve cache) OR locally manipulated via `build...` /
        // `set...` (preserve unsaved edits). Either way the preloader would
        // overwrite that state.
        for (const sibling of cohort) {
            if (sibling.constructor !== OwnerModelClass)
                continue;
            if (!sibling.isPersisted())
                continue;
            const siblingInstanceRelationship = sibling.getRelationshipByName(relationshipName);
            if (siblingInstanceRelationship.getLoadedOrUndefined() !== undefined)
                continue;
            batch.push(sibling);
        }
        if (batch.length === 0)
            return false;
        const type = relationshipDef.getType();
        if (type == "belongsTo") {
            const belongsToRelationship = /** @type {import("../relationships/belongs-to.js").default} */ (relationshipDef);
            const preloader = new BelongsToPreloader({ models: batch, relationship: belongsToRelationship });
            await preloader.run();
        }
        else if (type == "hasMany") {
            const hasManyRelationship = /** @type {import("../relationships/has-many.js").default} */ (relationshipDef);
            const preloader = new HasManyPreloader({ models: batch, relationship: hasManyRelationship });
            await preloader.run();
        }
        else if (type == "hasOne") {
            const hasOneRelationship = /** @type {import("../relationships/has-one.js").default} */ (relationshipDef);
            const preloader = new HasOnePreloader({ models: batch, relationship: hasOneRelationship });
            await preloader.run();
        }
        else {
            throw new Error(`Unknown relationship type: ${type}`);
        }
        return true;
    }
    /**
     * Runs is loaded.
     * @returns {boolean} Whether the relationship has been preloaded
     */
    isLoaded() { return Boolean(this._loaded); }
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
    /**
     * Runs set loaded.
     * @param {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} model - Related model(s) to mark as loaded.
     */
    setLoaded(model) { this._loaded = model; }
    /**
     * Runs get loaded or undefined.
     * @returns {InstanceType<TMC> | InstanceType<TMC>[] | undefined} - The loaded or undefined.
     */
    getLoadedOrUndefined() { return this._loaded; }
    /**
     * Runs get preloaded.
     * @returns {boolean} The loaded model or models (depending on relationship type)
     */
    getPreloaded() { return this._preloaded || false; }
    /**
     * Runs set preloaded.
     * @param {boolean} isPreloaded - Whether the relationship is preloaded.
     */
    setPreloaded(isPreloaded) { this._preloaded = isPreloaded; }
    /**
     * Runs get foreign key.
     * @returns {string} The foreign key for this relationship
     */
    getForeignKey() { return this.getRelationship().getForeignKey(); }
    /**
     * Runs get model.
     * @returns {InstanceType<MC>} - The model.
     */
    getModel() { return this.model; }
    /**
     * Runs get primary key.
     * @returns {string} The primary key for this relationship's model
     */
    getPrimaryKey() { return this.getRelationship().getPrimaryKey(); }
    /**
     * Runs get relationship.
     * @returns {import("../relationships/base.js").default} The relationship object that this instance relationship is based on
     */
    getRelationship() { return this.relationship.resolveForRecord(this.model); }
    /**
     * Runs apply scope.
     * @template T
     * @param {T} query - Query instance.
     * @returns {T} - Scoped query.
     */
    applyScope(query) {
        return this.getRelationship().applyScope(query);
    }
    /**
     * Runs get target model class.
     * @returns {TMC | undefined} The model class that this instance relationship
     */
    getTargetModelClass() {
        const TargetModelClass = /** @type {TMC} */ (this.getRelationship().getTargetModelClass());
        return TargetModelClass;
    }
    /**
     * Runs get type.
     * @returns {string} The type of relationship (e.g. "has_many", "belongs_to", etc.)
     */
    getType() { return this.getRelationship().getType(); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGtCQUFrQixNQUFNLHFDQUFxQyxDQUFBO0FBQ3BFLE9BQU8sZ0JBQWdCLE1BQU0sbUNBQW1DLENBQUE7QUFDaEUsT0FBTyxlQUFlLE1BQU0sa0NBQWtDLENBQUE7QUFFOUQ7Ozs7Ozs7R0FPRztBQUVIOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLCtDQUErQztJQUNsRTs7cUNBRWlDO0lBQ2pDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDckI7O3FDQUVpQztJQUNqQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBQ3RCOzswRUFFc0U7SUFDdEUsT0FBTyxHQUFHLFNBQVMsQ0FBQTtJQUVuQjs7O09BR0c7SUFDSCxZQUFZLEVBQUMsS0FBSyxFQUFFLFlBQVksRUFBQztRQUMvQixJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQTtRQUNuQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtRQUNsQixJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxXQUFXLENBQUMsTUFBTTtRQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLFVBQVU7UUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0I7UUFDdEIsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUVuRCxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsT0FBTyxTQUFTLENB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QyxDQUFBO0lBQ2pELENBQUM7SUFFRDs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsTUFBTSxnQkFBZ0IsR0FBRyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLENBQUE7UUFFMUYsT0FBTyxnQkFBZ0IsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQztDQUN0RCIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmVsb25nc1RvUHJlbG9hZGVyIGZyb20gXCIuLi8uLi9xdWVyeS9wcmVsb2FkZXIvYmVsb25ncy10by5qc1wiXG5pbXBvcnQgSGFzTWFueVByZWxvYWRlciBmcm9tIFwiLi4vLi4vcXVlcnkvcHJlbG9hZGVyL2hhcy1tYW55LmpzXCJcbmltcG9ydCBIYXNPbmVQcmVsb2FkZXIgZnJvbSBcIi4uLy4uL3F1ZXJ5L3ByZWxvYWRlci9oYXMtb25lLmpzXCJcblxuLyoqXG4gKiBJbnN0YW5jZVJlbGF0aW9uc2hpcHNCYXNlQXJncyB0eXBlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gW01DPXR5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gW1RNQz10eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdF1cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluc3RhbmNlUmVsYXRpb25zaGlwc0Jhc2VBcmdzXG4gKiBAcHJvcGVydHkge0luc3RhbmNlVHlwZTxNQz59IG1vZGVsIC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhIGRlZmluaXRpb24uXG4gKi9cblxuLyoqXG4gKiBBIGdlbmVyaWMgcXVlcnkgb3ZlciBzb21lIG1vZGVsIHR5cGUuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBbVE1DPXR5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZEJhc2VJbnN0YW5jZVJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBBdXRvIHNhdmUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBfYXV0b1NhdmUgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIFByZWxvYWRlZC5cbiAgICogQHR5cGUge2Jvb2xlYW4gfCB1bmRlZmluZWR9ICovXG4gIF9wcmVsb2FkZWQgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIExvYWRlZC5cbiAgICogQHR5cGUge0luc3RhbmNlVHlwZTxUTUM+IHwgQXJyYXk8SW5zdGFuY2VUeXBlPFRNQz4+IHwgdW5kZWZpbmVkfSAqL1xuICBfbG9hZGVkID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7SW5zdGFuY2VSZWxhdGlvbnNoaXBzQmFzZUFyZ3M8TUMsIFRNQz59IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttb2RlbCwgcmVsYXRpb25zaGlwfSkge1xuICAgIHRoaXMuX2RpcnR5ID0gZmFsc2VcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHRvIGxvYWRlZC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7SW5zdGFuY2VUeXBlPFRNQz5bXSB8IEluc3RhbmNlVHlwZTxUTUM+fSBtb2RlbHMgLSBNb2RlbCBpbnN0YW5jZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFRvTG9hZGVkKG1vZGVscykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiYWRkVG9Mb2FkZWQgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7Q29uc3RydWN0b3JQYXJhbWV0ZXJzPFRNQz5bMF19IGF0dHJpYnV0ZXMgLSBUYXJnZXQgbW9kZWwgd3JpdGUgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUTUM+fSAtIFRoZSBidWlsZC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIididWlsZCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZWxhdGlvbnNoaXAgdGFyZ2V0IHRocm91Z2ggdGhlIHNvdXJjZSByZWNvcmQncyBvcGVyYXRpb24gYW5kXG4gICAqIG1ldGFkYXRhIGdlbmVyYXRpb24gYmVmb3JlIGNvbnN0cnVjdGlvbi5cbiAgICogQHJldHVybnMge1RNQyB8IHVuZGVmaW5lZH0gLSBCb3VuZCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRCb3VuZFRhcmdldE1vZGVsQ2xhc3MoKSB7XG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiAvKiogQHR5cGUge1RNQ30gKi8gKHRoaXMuZ2V0TW9kZWwoKS5nZXRNb2RlbENsYXNzKCkuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvIHNhdmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgdW5kZWZpbmVkfSBXaGV0aGVyIHRoZSByZWxhdGlvbnNoaXAgc2hvdWxkIGJlIGF1dG8tc2F2ZWQgYmVmb3JlIHNhdmluZyB0aGUgcGFyZW50IG1vZGVsXG4gICAqL1xuICBnZXRBdXRvU2F2ZSgpIHsgcmV0dXJuIHRoaXMuX2F1dG9TYXZlIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXV0byBzYXZlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0F1dG9TYXZlVmFsdWUgV2hldGhlciB0aGUgcmVsYXRpb25zaGlwIHNob3VsZCBiZSBhdXRvLXNhdmVkIGJlZm9yZSBzYXZpbmcgdGhlIHBhcmVudCBtb2RlbFxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBdXRvU2F2ZShuZXdBdXRvU2F2ZVZhbHVlKSB7IHRoaXMuX2F1dG9TYXZlID0gbmV3QXV0b1NhdmVWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGRpcnR5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIFdoZXRoZXIgdGhlIHJlbGF0aW9uc2hpcCBpcyBkaXJ0eSAoaGFzIGJlZW4gbW9kaWZpZWQpXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldERpcnR5KG5ld1ZhbHVlKSB7IHRoaXMuX2RpcnR5ID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkaXJ0eS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHJlbGF0aW9uc2hpcCBpcyBkaXJ0eSAoaGFzIGJlZW4gbW9kaWZpZWQpXG4gICAqL1xuICBnZXREaXJ0eSgpIHsgcmV0dXJuIHRoaXMuX2RpcnR5IH1cblxuICAvKipcbiAgICogUnVucyBsb2FkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFRNQz4gfCBBcnJheTxJbnN0YW5jZVR5cGU8VE1DPj4gfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggbG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGxvYWQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2xvYWQnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSByZWxhdGlvbnNoaXAgaWYgbm90IGFscmVhZHkgbG9hZGVkLiBXaGVuIHRoZSBwYXJlbnQgcmVjb3JkIHdhc1xuICAgKiBsb2FkZWQgYXMgcGFydCBvZiBhIGJhdGNoIChjb2hvcnQpIGFuZCBhdXRvbG9hZCBpcyBlbmFibGVkLCBzaWJsaW5ncyBpblxuICAgKiB0aGUgY29ob3J0IHRoYXQgc2hhcmUgdGhpcyByZWxhdGlvbnNoaXAgYW5kIGhhdmUgbm90IHByZWxvYWRlZCBpdCB5ZXRcbiAgICogYXJlIGJhdGNoZWQgaW50byBhIHNpbmdsZSBxdWVyeSB2aWEgdGhlIGV4aXN0aW5nIHByZWxvYWRlciBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VE1DPiB8IEFycmF5PEluc3RhbmNlVHlwZTxUTUM+PiB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCBsb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgYXV0b2xvYWRPckxvYWQoKSB7XG4gICAgaWYgKHRoaXMuX2xvYWRlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fbG9hZGVkXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZCgpXG5cbiAgICBpZiAoIWJhdGNoZWQpIGF3YWl0IHRoaXMubG9hZCgpXG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYmF0Y2gtbG9hZCB0aGlzIHJlbGF0aW9uc2hpcCBhY3Jvc3MgY29ob3J0IHNpYmxpbmdzIHZpYSB0aGVcbiAgICogZXhpc3RpbmcgcHJlbG9hZGVyIHBhdGguIFJldHVybnMgdHJ1ZSB3aGVuIGEgYmF0Y2ggcmFuIChzZWxmIGlzIGFsd2F5c1xuICAgKiBpbmNsdWRlZCBiZWNhdXNlIGNhbGxlcnMgcmVzZXQgdGhlaXIgb3duIGBfcHJlbG9hZGVkYCBzdGF0ZSBiZWZvcmVcbiAgICogY2FsbGluZyksIGZhbHNlIHdoZW4gYXV0b2xvYWQgaXMgb2ZmLCB0aGVyZSBpcyBubyBjb2hvcnQsIG9yIG5vIGJhdGNoXG4gICAqIGNhbmRpZGF0ZXMgcmVtYWluLiBTaWJsaW5ncyB0aGF0IGhhdmUgYWxyZWFkeSBwcmVsb2FkZWQgdGhpcyByZWxhdGlvbnNoaXBcbiAgICogYXJlIHNraXBwZWQgc28gdGhlaXIgY2FjaGVkIHZhbHVlIGlzIHByZXNlcnZlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIGNvaG9ydCBiYXRjaCBwcmVsb2FkIHJhbi5cbiAgICovXG4gIGFzeW5jIF90cnlDb2hvcnRQcmVsb2FkKCkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZiA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwKClcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gcmVsYXRpb25zaGlwRGVmLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGNvaG9ydCA9IC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5tb2RlbCkuX2xvYWRDb2hvcnQpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24uZ2V0QXV0b2xvYWQoKSB8fCAhcmVsYXRpb25zaGlwRGVmLmdldEF1dG9sb2FkKCkgfHwgIWNvaG9ydCB8fCBjb2hvcnQubGVuZ3RoIDw9IDEpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBEZWYuZ2V0UmVsYXRpb25zaGlwTmFtZSgpXG4gICAgY29uc3QgT3duZXJNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMubW9kZWwpLmNvbnN0cnVjdG9yXG4gICAgLyoqXG4gICAgICogQmF0Y2guXG4gICAgICogQHR5cGUge0FycmF5PGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGJhdGNoID0gW11cblxuICAgIC8vIEV4YWN0IHNhbWUgY2xhc3MsIHBlcnNpc3RlZCwgbm8gZXhpc3RpbmcgaW4tbWVtb3J5IHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICAvLyBTa2lwIHNpYmxpbmdzIHdoZXJlIGBfbG9hZGVkYCBpcyBhbHJlYWR5IHNldCDigJQgdGhleSBtYXkgaGF2ZSBiZWVuXG4gICAgLy8gcHJlbG9hZGVkIChwcmVzZXJ2ZSBjYWNoZSkgT1IgbG9jYWxseSBtYW5pcHVsYXRlZCB2aWEgYGJ1aWxkLi4uYCAvXG4gICAgLy8gYHNldC4uLmAgKHByZXNlcnZlIHVuc2F2ZWQgZWRpdHMpLiBFaXRoZXIgd2F5IHRoZSBwcmVsb2FkZXIgd291bGRcbiAgICAvLyBvdmVyd3JpdGUgdGhhdCBzdGF0ZS5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgY29ob3J0KSB7XG4gICAgICBpZiAoc2libGluZy5jb25zdHJ1Y3RvciAhPT0gT3duZXJNb2RlbENsYXNzKSBjb250aW51ZVxuICAgICAgaWYgKCFzaWJsaW5nLmlzUGVyc2lzdGVkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHNpYmxpbmdJbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHNpYmxpbmcuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChzaWJsaW5nSW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSAhPT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgICBiYXRjaC5wdXNoKHNpYmxpbmcpXG4gICAgfVxuXG4gICAgaWYgKGJhdGNoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0eXBlID0gcmVsYXRpb25zaGlwRGVmLmdldFR5cGUoKVxuXG4gICAgaWYgKHR5cGUgPT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgY29uc3QgYmVsb25nc1RvUmVsYXRpb25zaGlwID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWxhdGlvbnNoaXBzL2JlbG9uZ3MtdG8uanNcIikuZGVmYXVsdH0gKi8gKHJlbGF0aW9uc2hpcERlZilcbiAgICAgIGNvbnN0IHByZWxvYWRlciA9IG5ldyBCZWxvbmdzVG9QcmVsb2FkZXIoe21vZGVsczogYmF0Y2gsIHJlbGF0aW9uc2hpcDogYmVsb25nc1RvUmVsYXRpb25zaGlwfSlcblxuICAgICAgYXdhaXQgcHJlbG9hZGVyLnJ1bigpXG4gICAgfSBlbHNlIGlmICh0eXBlID09IFwiaGFzTWFueVwiKSB7XG4gICAgICBjb25zdCBoYXNNYW55UmVsYXRpb25zaGlwID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCIpLmRlZmF1bHR9ICovIChyZWxhdGlvbnNoaXBEZWYpXG4gICAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgSGFzTWFueVByZWxvYWRlcih7bW9kZWxzOiBiYXRjaCwgcmVsYXRpb25zaGlwOiBoYXNNYW55UmVsYXRpb25zaGlwfSlcblxuICAgICAgYXdhaXQgcHJlbG9hZGVyLnJ1bigpXG4gICAgfSBlbHNlIGlmICh0eXBlID09IFwiaGFzT25lXCIpIHtcbiAgICAgIGNvbnN0IGhhc09uZVJlbGF0aW9uc2hpcCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVsYXRpb25zaGlwcy9oYXMtb25lLmpzXCIpLmRlZmF1bHR9ICovIChyZWxhdGlvbnNoaXBEZWYpXG4gICAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgSGFzT25lUHJlbG9hZGVyKHttb2RlbHM6IGJhdGNoLCByZWxhdGlvbnNoaXA6IGhhc09uZVJlbGF0aW9uc2hpcH0pXG5cbiAgICAgIGF3YWl0IHByZWxvYWRlci5ydW4oKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7dHlwZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZWxhdGlvbnNoaXAgaGFzIGJlZW4gcHJlbG9hZGVkXG4gICAqL1xuICBpc0xvYWRlZCgpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5fbG9hZGVkKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPFRNQz4gfCBBcnJheTxJbnN0YW5jZVR5cGU8VE1DPj4gfCB1bmRlZmluZWR9IFRoZSBsb2FkZWQgbW9kZWwgb3IgbW9kZWxzIChkZXBlbmRpbmcgb24gcmVsYXRpb25zaGlwIHR5cGUpXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQgJiYgdGhpcy5tb2RlbC5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9hZGVkLlxuICAgKiBAcGFyYW0ge0luc3RhbmNlVHlwZTxUTUM+IHwgQXJyYXk8SW5zdGFuY2VUeXBlPFRNQz4+IHwgdW5kZWZpbmVkfSBtb2RlbCAtIFJlbGF0ZWQgbW9kZWwocykgdG8gbWFyayBhcyBsb2FkZWQuXG4gICAqL1xuICBzZXRMb2FkZWQobW9kZWwpIHsgdGhpcy5fbG9hZGVkID0gbW9kZWwgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2FkZWQgb3IgdW5kZWZpbmVkLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPFRNQz4gfCBJbnN0YW5jZVR5cGU8VE1DPltdIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2FkZWQgb3IgdW5kZWZpbmVkLlxuICAgKi9cbiAgZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSB7IHJldHVybiB0aGlzLl9sb2FkZWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmVsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBUaGUgbG9hZGVkIG1vZGVsIG9yIG1vZGVscyAoZGVwZW5kaW5nIG9uIHJlbGF0aW9uc2hpcCB0eXBlKVxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkgeyByZXR1cm4gdGhpcy5fcHJlbG9hZGVkIHx8IGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcHJlbG9hZGVkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGlzUHJlbG9hZGVkIC0gV2hldGhlciB0aGUgcmVsYXRpb25zaGlwIGlzIHByZWxvYWRlZC5cbiAgICovXG4gIHNldFByZWxvYWRlZChpc1ByZWxvYWRlZCkgeyB0aGlzLl9wcmVsb2FkZWQgPSBpc1ByZWxvYWRlZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZvcmVpZ24ga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgZm9yZWlnbiBrZXkgZm9yIHRoaXMgcmVsYXRpb25zaGlwXG4gICAqL1xuICBnZXRGb3JlaWduS2V5KCkgeyByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXAoKS5nZXRGb3JlaWduS2V5KCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbC5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxNQz59IC0gVGhlIG1vZGVsLlxuICAgKi9cbiAgZ2V0TW9kZWwoKSB7IHJldHVybiB0aGlzLm1vZGVsIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBwcmltYXJ5IGtleSBmb3IgdGhpcyByZWxhdGlvbnNoaXAncyBtb2RlbFxuICAgKi9cbiAgZ2V0UHJpbWFyeUtleSgpIHsgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UHJpbWFyeUtleSgpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IFRoZSByZWxhdGlvbnNoaXAgb2JqZWN0IHRoYXQgdGhpcyBpbnN0YW5jZSByZWxhdGlvbnNoaXAgaXMgYmFzZWQgb25cbiAgICovXG4gIGdldFJlbGF0aW9uc2hpcCgpIHsgcmV0dXJuIHRoaXMucmVsYXRpb25zaGlwLnJlc29sdmVGb3JSZWNvcmQodGhpcy5tb2RlbCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1R9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtUfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIGFwcGx5U2NvcGUocXVlcnkpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXAoKS5hcHBseVNjb3BlKHF1ZXJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1RNQyB8IHVuZGVmaW5lZH0gVGhlIG1vZGVsIGNsYXNzIHRoYXQgdGhpcyBpbnN0YW5jZSByZWxhdGlvbnNoaXBcbiAgICovXG4gIGdldFRhcmdldE1vZGVsQ2xhc3MoKSB7XG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7VE1DfSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXAoKS5nZXRUYXJnZXRNb2RlbENsYXNzKCkpXG5cbiAgICByZXR1cm4gVGFyZ2V0TW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSB0eXBlIG9mIHJlbGF0aW9uc2hpcCAoZS5nLiBcImhhc19tYW55XCIsIFwiYmVsb25nc190b1wiLCBldGMuKVxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0VHlwZSgpIH1cbn1cbiJdfQ==