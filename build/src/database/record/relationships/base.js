// @ts-check
import restArgsError from "../../../utils/rest-args-error.js";
import * as inflection from "inflection";
/**
 * RelationshipScopeCallback type.
 * @typedef {(query: import("../../query/model-class-query.js").default<typeof import("../index.js").default>) => (import("../../query/model-class-query.js").default<typeof import("../index.js").default> | void)} RelationshipScopeCallback
 */
/**
 * RelationshipRecordResolver type.
 * @typedef {(record: import("../index.js").default) => VelociousDatabaseRecordBaseRelationship} RelationshipRecordResolver
 */
/**
 * RelationshipBaseArgsType type.
 * @typedef {object} RelationshipBaseArgsType
 * @property {boolean} [autoload] - Whether to auto-batch-preload siblings when this relationship is lazy-loaded. Default true.
 * @property {string} [className] - Name of the related model class.
 * @property {boolean} [counterCache] - Auto-sync parent count column on create/update/destroy.
 * @property {string} [dependent] - Dependent action when parent is destroyed.
 * @property {string | undefined} [foreignKey] - Explicit foreign key column name.
 * @property {string} [inverseOf] - Inverse relationship name on the related model.
 * @property {typeof import("../index.js").default} [klass] - Related model class.
 * @property {typeof import("../index.js").default} modelClass - Owning model class.
 * @property {string} [primaryKey] - Primary key column on the owning model.
 * @property {boolean} [polymorphic] - Whether the relationship is polymorphic.
 * @property {string} relationshipName - Name of the relationship on the model.
 * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
 * @property {string} [through] - Name of the through association.
 * @property {string} type - Relationship type (e.g. "hasMany").
 */
export default class VelociousDatabaseRecordBaseRelationship {
    /**
     * Runs constructor.
     * @param {RelationshipBaseArgsType} args - Relationship definition arguments.
     */
    constructor({ autoload, className, counterCache, dependent, foreignKey, inverseOf, klass, modelClass, primaryKey = "id", polymorphic, relationshipName, scope, through, type, ...restArgs }) {
        restArgsError(restArgs);
        if (!modelClass)
            throw new Error(`'modelClass' wasn't given for ${relationshipName}`);
        if (!className && !klass && !polymorphic)
            throw new Error(`Neither 'className' or 'klass' was given for ${modelClass.name}#${relationshipName}`);
        if (className == "EventSery") {
            throw new Error(`Invalid model name: ${className}`);
        }
        this._autoload = autoload !== false;
        this.className = className;
        this._counterCache = counterCache || false;
        this._dependent = dependent;
        this.foreignKey = foreignKey;
        this._explicitForeignKey = foreignKey;
        this._inverseOf = inverseOf;
        this.klass = klass;
        this.modelClass = modelClass;
        this._polymorphic = polymorphic;
        this._primaryKey = primaryKey;
        this.relationshipName = relationshipName;
        this._scope = scope;
        this.through = through;
        this.type = type;
    }
    /**
     * Installs metadata selection for relationships whose physical definition varies by record operation.
     * @param {RelationshipRecordResolver} resolver - Record-owned relationship resolver.
     * @returns {void}
     */
    setRecordResolver(resolver) {
        this._recordResolver = resolver;
    }
    /**
     * Resolves this relationship for a record's captured physical database identity.
     * @param {import("../index.js").default} record - Record owning the relationship access.
     * @returns {VelociousDatabaseRecordBaseRelationship} - Physical relationship metadata.
     */
    resolveForRecord(record) {
        return this._recordResolver ? this._recordResolver(record) : this;
    }
    /**
     * Runs get autoload.
     * @returns {boolean} Whether this relationship auto-batch-preloads siblings on lazy access.
     */
    getAutoload() { return this._autoload; }
    getConfiguration() { return this.modelClass._getConfiguration(); }
    /**
     * Runs get counter cache.
     * @returns {boolean} Whether a counter cache column is synced on the parent.
     */
    getCounterCache() { return this._counterCache; }
    /**
     * Runs get dependent.
     * @returns {string | undefined} What will be done when the parent record is destroyed. E.g. "destroy", "nullify", "restrict" etc.
     */
    getDependent() { return this._dependent; }
    /**
     * The foreign key explicitly passed when the relationship was declared, if any. Unlike
     * `getForeignKey()` this never falls back to a computed default, so callers can tell whether the
     * developer named a specific column (e.g. to disambiguate multiple belongs-to on a through target).
     * @returns {string | undefined} - The explicitly declared foreign key, or undefined.
     */
    getExplicitForeignKey() { return this._explicitForeignKey; }
    /**
     * Runs get foreign key.
     * @abstract
     * @returns {string} The name of the foreign key, e.g. "user_id", "post_id" etc.
     */
    getForeignKey() {
        throw new Error("getForeignKey not implemented");
    }
    /**
     * Resolves an attribute-form foreign key through the model class that owns the physical column.
     * @param {object} args - Bound relationship model classes.
     * @param {typeof import("../index.js").default} args.modelClass - Relationship source model class.
     * @param {typeof import("../index.js").default} args.targetModelClass - Relationship target model class.
     * @returns {string} - Physical foreign-key column name.
     */
    getForeignKeyForModelClasses({ modelClass, targetModelClass }) {
        this.getForeignKey();
        if (!this.foreignKey)
            throw new Error(`Relationship ${this.modelClass.name}#${this.relationshipName} did not resolve a foreign key`);
        const foreignKeyModelClass = this.getType() === "belongsTo" ? modelClass : targetModelClass;
        return foreignKeyModelClass.getAttributeNameToColumnNameMap()[this.foreignKey] || this.foreignKey;
    }
    /**
     * Runs get inverse of.
     * @abstract
     * @returns {string | undefined} The name of the inverse relationship, e.g. "posts", "comments" etc.
     */
    getInverseOf() {
        throw new Error("getInverseOf not implemented");
    }
    /**
     * Runs get model class.
     * @returns {typeof import("../index.js").default} - The model class.
     */
    getModelClass() { return this.modelClass; }
    /**
     * Runs get relationship name.
     * @returns {string} The name of the relationship, e.g. "posts", "user", "comments" etc.
     */
    getRelationshipName() { return this.relationshipName; }
    /**
     * Runs get scope.
     * @returns {RelationshipScopeCallback | undefined} - The scope callback.
     */
    getScope() { return this._scope; }
    /**
     * Runs apply scope.
     * @template T
     * @param {T} query - Query instance.
     * @returns {T} - Scoped query.
     */
    applyScope(query) {
        const scope = this.getScope();
        if (!scope)
            return query;
        const scopedQuery = /** @type {T | void} */ (scope.call(query, /** @type {import("../../query/model-class-query.js").default<typeof import("../index.js").default>} */ (query)));
        return scopedQuery || query;
    }
    /**
     * Runs get polymorphic.
     * @returns {boolean} - Whether polymorphic.
     */
    getPolymorphic() {
        return this._polymorphic || false;
    }
    /**
     * Runs get polymorphic type column.
     * @returns {string} - The polymorphic type column.
     */
    getPolymorphicTypeColumn() {
        if (!this.getPolymorphic()) {
            throw new Error(`${this.modelClass.name}#${this.relationshipName} isn't polymorphic`);
        }
        if (!this._polymorphicTypeColumn) {
            const foreignKey = this.getForeignKey();
            if (foreignKey && foreignKey.endsWith("_id")) {
                this._polymorphicTypeColumn = foreignKey.replace(/_id$/, "_type");
            }
            else {
                const underscoredName = inflection.underscore(this.getRelationshipName());
                this._polymorphicTypeColumn = `${underscoredName}_type`;
            }
        }
        return this._polymorphicTypeColumn;
    }
    /**
     * Runs get primary key.
     * @returns {string} The name of the foreign key, e.g. "id" etc.
     */
    getPrimaryKey() { return this._primaryKey; }
    /**
     * Runs get type.
     * @returns {string} The type of the relationship, e.g. "has_many", "belongs_to", "has_one", "has_and_belongs_to_many" etc.
     */
    getType() { return this.type; }
    /**
     * Runs get target model class.
     * @returns {typeof import("../index.js").default | undefined} The target model class for this relationship, e.g. if the relationship is "posts" then the target model class is the Post class.
     */
    getTargetModelClass() {
        if (this.getPolymorphic() && this.type == "belongsTo") {
            return undefined;
        }
        else if (this.className) {
            return this.getConfiguration().getModelClass(this.className);
        }
        else if (this.klass) {
            return this.klass;
        }
        throw new Error("Couldn't figure out the target model class");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSxtQ0FBbUMsQ0FBQTtBQUM3RCxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUV4Qzs7O0dBR0c7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLHVDQUF1QztJQUMxRDs7O09BR0c7SUFDSCxZQUFZLEVBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxVQUFVLEdBQUcsSUFBSSxFQUFFLFdBQVcsRUFBRSxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN2TCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUE7UUFDckYsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLFdBQVc7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxVQUFVLENBQUMsSUFBSSxJQUFJLGdCQUFnQixFQUFFLENBQUMsQ0FBQTtRQUVoSixJQUFJLFNBQVMsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUM3QixNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBQ3JELENBQUM7UUFFRCxJQUFJLENBQUMsU0FBUyxHQUFHLFFBQVEsS0FBSyxLQUFLLENBQUE7UUFDbkMsSUFBSSxDQUFDLFNBQVMsR0FBRyxT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QTtZQUN6RCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFBO0lBQ3BDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxhQUFhLEtBQUssT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBLENBQUMsQ0FBQztJQUUzQzs7O09BR0c7SUFDSCxPQUFPLEtBQUssT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFBLENBQUMsQ0FBQztJQUU5Qjs7O09BR0c7SUFDSCxtQkFBbUI7UUFDakIsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLElBQUksSUFBSSxDQUFDLElBQUksSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUN0RCxPQUFPLFNBQVMsQ0FBQTtRQUNsQixDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDMUIsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQzlELENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUN0QixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7UUFDbkIsQ0FBQztRQUVELE1BQU0sSUFBSSxLQUFLLENBQUMsNENBQTRDLENBQUMsQ0FBQTtJQUMvRCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcblxuLyoqXG4gKiBSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHR5cGUuXG4gKiBAdHlwZWRlZiB7KHF1ZXJ5OiBpbXBvcnQoXCIuLi8uLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0PikgPT4gKGltcG9ydChcIi4uLy4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHQ+IHwgdm9pZCl9IFJlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2tcbiAqL1xuLyoqXG4gKiBSZWxhdGlvbnNoaXBSZWNvcmRSZXNvbHZlciB0eXBlLlxuICogQHR5cGVkZWYgeyhyZWNvcmQ6IGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkQmFzZVJlbGF0aW9uc2hpcH0gUmVsYXRpb25zaGlwUmVjb3JkUmVzb2x2ZXJcbiAqL1xuLyoqXG4gKiBSZWxhdGlvbnNoaXBCYXNlQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlbGF0aW9uc2hpcEJhc2VBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbYXV0b2xvYWRdIC0gV2hldGhlciB0byBhdXRvLWJhdGNoLXByZWxvYWQgc2libGluZ3Mgd2hlbiB0aGlzIHJlbGF0aW9uc2hpcCBpcyBsYXp5LWxvYWRlZC4gRGVmYXVsdCB0cnVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjbGFzc05hbWVdIC0gTmFtZSBvZiB0aGUgcmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2NvdW50ZXJDYWNoZV0gLSBBdXRvLXN5bmMgcGFyZW50IGNvdW50IGNvbHVtbiBvbiBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlcGVuZGVudF0gLSBEZXBlbmRlbnQgYWN0aW9uIHdoZW4gcGFyZW50IGlzIGRlc3Ryb3llZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBbZm9yZWlnbktleV0gLSBFeHBsaWNpdCBmb3JlaWduIGtleSBjb2x1bW4gbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaW52ZXJzZU9mXSAtIEludmVyc2UgcmVsYXRpb25zaGlwIG5hbWUgb24gdGhlIHJlbGF0ZWQgbW9kZWwuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBba2xhc3NdIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBPd25pbmcgbW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3ByaW1hcnlLZXldIC0gUHJpbWFyeSBrZXkgY29sdW1uIG9uIHRoZSBvd25pbmcgbW9kZWwuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtwb2x5bW9ycGhpY10gLSBXaGV0aGVyIHRoZSByZWxhdGlvbnNoaXAgaXMgcG9seW1vcnBoaWMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIE5hbWUgb2YgdGhlIHJlbGF0aW9uc2hpcCBvbiB0aGUgbW9kZWwuXG4gKiBAcHJvcGVydHkge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2t9IFtzY29wZV0gLSBPcHRpb25hbCBzY29wZSBjYWxsYmFjayBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdGhyb3VnaF0gLSBOYW1lIG9mIHRoZSB0aHJvdWdoIGFzc29jaWF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZSAoZS5nLiBcImhhc01hbnlcIikuXG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRCYXNlUmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwQmFzZUFyZ3NUeXBlfSBhcmdzIC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24gYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2F1dG9sb2FkLCBjbGFzc05hbWUsIGNvdW50ZXJDYWNoZSwgZGVwZW5kZW50LCBmb3JlaWduS2V5LCBpbnZlcnNlT2YsIGtsYXNzLCBtb2RlbENsYXNzLCBwcmltYXJ5S2V5ID0gXCJpZFwiLCBwb2x5bW9ycGhpYywgcmVsYXRpb25zaGlwTmFtZSwgc2NvcGUsIHRocm91Z2gsIHR5cGUsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgJ21vZGVsQ2xhc3MnIHdhc24ndCBnaXZlbiBmb3IgJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgaWYgKCFjbGFzc05hbWUgJiYgIWtsYXNzICYmICFwb2x5bW9ycGhpYykgdGhyb3cgbmV3IEVycm9yKGBOZWl0aGVyICdjbGFzc05hbWUnIG9yICdrbGFzcycgd2FzIGdpdmVuIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG5cbiAgICBpZiAoY2xhc3NOYW1lID09IFwiRXZlbnRTZXJ5XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBtb2RlbCBuYW1lOiAke2NsYXNzTmFtZX1gKVxuICAgIH1cblxuICAgIHRoaXMuX2F1dG9sb2FkID0gYXV0b2xvYWQgIT09IGZhbHNlXG4gICAgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWVcbiAgICB0aGlzLl9jb3VudGVyQ2FjaGUgPSBjb3VudGVyQ2FjaGUgfHwgZmFsc2VcbiAgICB0aGlzLl9kZXBlbmRlbnQgPSBkZXBlbmRlbnRcbiAgICB0aGlzLmZvcmVpZ25LZXkgPSBmb3JlaWduS2V5XG4gICAgdGhpcy5fZXhwbGljaXRGb3JlaWduS2V5ID0gZm9yZWlnbktleVxuICAgIHRoaXMuX2ludmVyc2VPZiA9IGludmVyc2VPZlxuICAgIHRoaXMua2xhc3MgPSBrbGFzc1xuICAgIHRoaXMubW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wb2x5bW9ycGhpYyA9IHBvbHltb3JwaGljXG4gICAgdGhpcy5fcHJpbWFyeUtleSA9IHByaW1hcnlLZXlcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy5fc2NvcGUgPSBzY29wZVxuICAgIHRoaXMudGhyb3VnaCA9IHRocm91Z2hcbiAgICB0aGlzLnR5cGUgPSB0eXBlXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgbWV0YWRhdGEgc2VsZWN0aW9uIGZvciByZWxhdGlvbnNoaXBzIHdob3NlIHBoeXNpY2FsIGRlZmluaXRpb24gdmFyaWVzIGJ5IHJlY29yZCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwUmVjb3JkUmVzb2x2ZXJ9IHJlc29sdmVyIC0gUmVjb3JkLW93bmVkIHJlbGF0aW9uc2hpcCByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRSZWNvcmRSZXNvbHZlcihyZXNvbHZlcikge1xuICAgIHRoaXMuX3JlY29yZFJlc29sdmVyID0gcmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGlzIHJlbGF0aW9uc2hpcCBmb3IgYSByZWNvcmQncyBjYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgb3duaW5nIHRoZSByZWxhdGlvbnNoaXAgYWNjZXNzLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRCYXNlUmVsYXRpb25zaGlwfSAtIFBoeXNpY2FsIHJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICovXG4gIHJlc29sdmVGb3JSZWNvcmQocmVjb3JkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlY29yZFJlc29sdmVyID8gdGhpcy5fcmVjb3JkUmVzb2x2ZXIocmVjb3JkKSA6IHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvbG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyByZWxhdGlvbnNoaXAgYXV0by1iYXRjaC1wcmVsb2FkcyBzaWJsaW5ncyBvbiBsYXp5IGFjY2Vzcy5cbiAgICovXG4gIGdldEF1dG9sb2FkKCkgeyByZXR1cm4gdGhpcy5fYXV0b2xvYWQgfVxuXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLm1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvdW50ZXIgY2FjaGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGEgY291bnRlciBjYWNoZSBjb2x1bW4gaXMgc3luY2VkIG9uIHRoZSBwYXJlbnQuXG4gICAqL1xuICBnZXRDb3VudGVyQ2FjaGUoKSB7IHJldHVybiB0aGlzLl9jb3VudGVyQ2FjaGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZXBlbmRlbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IFdoYXQgd2lsbCBiZSBkb25lIHdoZW4gdGhlIHBhcmVudCByZWNvcmQgaXMgZGVzdHJveWVkLiBFLmcuIFwiZGVzdHJveVwiLCBcIm51bGxpZnlcIiwgXCJyZXN0cmljdFwiIGV0Yy5cbiAgICovXG4gIGdldERlcGVuZGVudCgpIHsgcmV0dXJuIHRoaXMuX2RlcGVuZGVudCB9XG5cbiAgLyoqXG4gICAqIFRoZSBmb3JlaWduIGtleSBleHBsaWNpdGx5IHBhc3NlZCB3aGVuIHRoZSByZWxhdGlvbnNoaXAgd2FzIGRlY2xhcmVkLCBpZiBhbnkuIFVubGlrZVxuICAgKiBgZ2V0Rm9yZWlnbktleSgpYCB0aGlzIG5ldmVyIGZhbGxzIGJhY2sgdG8gYSBjb21wdXRlZCBkZWZhdWx0LCBzbyBjYWxsZXJzIGNhbiB0ZWxsIHdoZXRoZXIgdGhlXG4gICAqIGRldmVsb3BlciBuYW1lZCBhIHNwZWNpZmljIGNvbHVtbiAoZS5nLiB0byBkaXNhbWJpZ3VhdGUgbXVsdGlwbGUgYmVsb25ncy10byBvbiBhIHRocm91Z2ggdGFyZ2V0KS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgZXhwbGljaXRseSBkZWNsYXJlZCBmb3JlaWduIGtleSwgb3IgdW5kZWZpbmVkLlxuICAgKi9cbiAgZ2V0RXhwbGljaXRGb3JlaWduS2V5KCkgeyByZXR1cm4gdGhpcy5fZXhwbGljaXRGb3JlaWduS2V5IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZm9yZWlnbiBrZXkuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgbmFtZSBvZiB0aGUgZm9yZWlnbiBrZXksIGUuZy4gXCJ1c2VyX2lkXCIsIFwicG9zdF9pZFwiIGV0Yy5cbiAgICovXG4gIGdldEZvcmVpZ25LZXkoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0Rm9yZWlnbktleSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBhdHRyaWJ1dGUtZm9ybSBmb3JlaWduIGtleSB0aHJvdWdoIHRoZSBtb2RlbCBjbGFzcyB0aGF0IG93bnMgdGhlIHBoeXNpY2FsIGNvbHVtbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBCb3VuZCByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUmVsYXRpb25zaGlwIHNvdXJjZSBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gUmVsYXRpb25zaGlwIHRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQaHlzaWNhbCBmb3JlaWduLWtleSBjb2x1bW4gbmFtZS5cbiAgICovXG4gIGdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe21vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgdGhpcy5nZXRGb3JlaWduS2V5KClcblxuICAgIGlmICghdGhpcy5mb3JlaWduS2V5KSB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0aW9uc2hpcCAke3RoaXMubW9kZWxDbGFzcy5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gZGlkIG5vdCByZXNvbHZlIGEgZm9yZWlnbiBrZXlgKVxuXG4gICAgY29uc3QgZm9yZWlnbktleU1vZGVsQ2xhc3MgPSB0aGlzLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIiA/IG1vZGVsQ2xhc3MgOiB0YXJnZXRNb2RlbENsYXNzXG5cbiAgICByZXR1cm4gZm9yZWlnbktleU1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3RoaXMuZm9yZWlnbktleV0gfHwgdGhpcy5mb3JlaWduS2V5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaW52ZXJzZSBvZi5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IFRoZSBuYW1lIG9mIHRoZSBpbnZlcnNlIHJlbGF0aW9uc2hpcCwgZS5nLiBcInBvc3RzXCIsIFwiY29tbWVudHNcIiBldGMuXG4gICAqL1xuICBnZXRJbnZlcnNlT2YoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0SW52ZXJzZU9mIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHsgcmV0dXJuIHRoaXMubW9kZWxDbGFzcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwLCBlLmcuIFwicG9zdHNcIiwgXCJ1c2VyXCIsIFwiY29tbWVudHNcIiBldGMuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBOYW1lKCkgeyByZXR1cm4gdGhpcy5yZWxhdGlvbnNoaXBOYW1lIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgdW5kZWZpbmVkfSAtIFRoZSBzY29wZSBjYWxsYmFjay5cbiAgICovXG4gIGdldFNjb3BlKCkgeyByZXR1cm4gdGhpcy5fc2NvcGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1R9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtUfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIGFwcGx5U2NvcGUocXVlcnkpIHtcbiAgICBjb25zdCBzY29wZSA9IHRoaXMuZ2V0U2NvcGUoKVxuXG4gICAgaWYgKCFzY29wZSkgcmV0dXJuIHF1ZXJ5XG5cbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IC8qKiBAdHlwZSB7VCB8IHZvaWR9ICovIChzY29wZS5jYWxsKHF1ZXJ5LCAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAqLyAocXVlcnkpKSlcblxuICAgIHJldHVybiBzY29wZWRRdWVyeSB8fCBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBvbHltb3JwaGljLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHBvbHltb3JwaGljLlxuICAgKi9cbiAgZ2V0UG9seW1vcnBoaWMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BvbHltb3JwaGljIHx8IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcG9seW1vcnBoaWMgdHlwZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHBvbHltb3JwaGljIHR5cGUgY29sdW1uLlxuICAgKi9cbiAgZ2V0UG9seW1vcnBoaWNUeXBlQ29sdW1uKCkge1xuICAgIGlmICghdGhpcy5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbENsYXNzLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBpc24ndCBwb2x5bW9ycGhpY2ApXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9wb2x5bW9ycGhpY1R5cGVDb2x1bW4pIHtcbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSB0aGlzLmdldEZvcmVpZ25LZXkoKVxuXG4gICAgICBpZiAoZm9yZWlnbktleSAmJiBmb3JlaWduS2V5LmVuZHNXaXRoKFwiX2lkXCIpKSB7XG4gICAgICAgIHRoaXMuX3BvbHltb3JwaGljVHlwZUNvbHVtbiA9IGZvcmVpZ25LZXkucmVwbGFjZSgvX2lkJC8sIFwiX3R5cGVcIilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHVuZGVyc2NvcmVkTmFtZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZSh0aGlzLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgICB0aGlzLl9wb2x5bW9ycGhpY1R5cGVDb2x1bW4gPSBgJHt1bmRlcnNjb3JlZE5hbWV9X3R5cGVgXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3BvbHltb3JwaGljVHlwZUNvbHVtblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgbmFtZSBvZiB0aGUgZm9yZWlnbiBrZXksIGUuZy4gXCJpZFwiIGV0Yy5cbiAgICovXG4gIGdldFByaW1hcnlLZXkoKSB7IHJldHVybiB0aGlzLl9wcmltYXJ5S2V5IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gVGhlIHR5cGUgb2YgdGhlIHJlbGF0aW9uc2hpcCwgZS5nLiBcImhhc19tYW55XCIsIFwiYmVsb25nc190b1wiLCBcImhhc19vbmVcIiwgXCJoYXNfYW5kX2JlbG9uZ3NfdG9fbWFueVwiIGV0Yy5cbiAgICovXG4gIGdldFR5cGUoKSB7IHJldHVybiB0aGlzLnR5cGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gVGhlIHRhcmdldCBtb2RlbCBjbGFzcyBmb3IgdGhpcyByZWxhdGlvbnNoaXAsIGUuZy4gaWYgdGhlIHJlbGF0aW9uc2hpcCBpcyBcInBvc3RzXCIgdGhlbiB0aGUgdGFyZ2V0IG1vZGVsIGNsYXNzIGlzIHRoZSBQb3N0IGNsYXNzLlxuICAgKi9cbiAgZ2V0VGFyZ2V0TW9kZWxDbGFzcygpIHtcbiAgICBpZiAodGhpcy5nZXRQb2x5bW9ycGhpYygpICYmIHRoaXMudHlwZSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfSBlbHNlIGlmICh0aGlzLmNsYXNzTmFtZSkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3ModGhpcy5jbGFzc05hbWUpXG4gICAgfSBlbHNlIGlmICh0aGlzLmtsYXNzKSB7XG4gICAgICByZXR1cm4gdGhpcy5rbGFzc1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkNvdWxkbid0IGZpZ3VyZSBvdXQgdGhlIHRhcmdldCBtb2RlbCBjbGFzc1wiKVxuICB9XG59XG4iXX0=