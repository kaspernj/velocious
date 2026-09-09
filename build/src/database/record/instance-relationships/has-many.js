// @ts-check
import BaseInstanceRelationship from "./base.js";
import { hasManyThroughTargetForeignKey } from "../../query/preloader/has-many.js";
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordHasManyInstanceRelationship extends BaseInstanceRelationship {
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
        // Spawn new model of the targeted class
        const targetModelClass = this.getBoundTargetModelClass();
        if (!targetModelClass)
            throw new Error("Can't build a new record without a taget model class");
        const newInstance = this.getModel().bindRelatedRecord(
        /** @type {InstanceType<TMC>} */ (new targetModelClass(data)));
        // Add it to the loaded models of this relationship
        if (this._loaded === undefined) {
            this._loaded = [newInstance];
        }
        else if (Array.isArray(this._loaded)) {
            this._loaded.push(newInstance);
        }
        else {
            throw new Error(`Loaded had an unexpected type: ${typeof this._loaded}`);
        }
        // Set loaded on the models inversed relationship
        const inverseOf = this.getRelationship().getInverseOf();
        if (inverseOf) {
            const inverseInstanceRelationship = newInstance.getRelationshipByName(inverseOf);
            inverseInstanceRelationship.setAutoSave(false);
            inverseInstanceRelationship.setLoaded(this.getModel());
        }
        // Assign the foreign key to the new model
        const parentModel = this.getModel();
        if (parentModel.isPersisted()) {
            const foreignKeyName = this.getRelationship().getForeignKeyForModelClasses({
                modelClass: parentModel.getModelClass(),
                targetModelClass
            });
            const columnNameMap = targetModelClass.getColumnNameToAttributeNameMap();
            const foreignKeyAttributeName = columnNameMap[foreignKeyName];
            if (!foreignKeyAttributeName)
                throw new Error(`Unknown foreign key attribute name for ${foreignKeyName}`);
            const primaryKeyName = this.getPrimaryKey();
            const foreignKeyValue = parentModel.readColumn(primaryKeyName);
            /**
             * Assign data.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const assignData = {};
            assignData[foreignKeyAttributeName] = foreignKeyValue;
            newInstance.assign(assignData);
        }
        // Return the new contructed model
        return newInstance;
    }
    /**
     * Runs create.
     * @param {ConstructorParameters<TMC>[0]} data - Target model write attributes.
     * @returns {Promise<InstanceType<TMC>>} - Resolves with the create.
     */
    async create(data) {
        const model = this.build(data);
        await model.save();
        return model;
    }
    /**
     * Runs load.
     * @returns {Promise<InstanceType<TMC>[]>} - Resolves with loaded models.
     */
    async load() {
        // Force-reload: discard the cached value and fetch fresh. When the parent
        // record was loaded as part of a batch, route through the cohort preloader
        // so siblings that have not preloaded this relationship get batched too.
        // The scoped query path (`instance.query().where(...).load()`) bypasses
        // this and stays a single-record load by design.
        this._preloaded = false;
        this._loaded = undefined;
        const batched = await this._tryCohortPreload();
        if (batched) {
            return /** @type {InstanceType<TMC>[]} */ (Array.isArray(this._loaded) ? this._loaded : []);
        }
        const foreignModels = /** @type {InstanceType<TMC>[]} */ (await this.query().load());
        this.setLoaded(foreignModels);
        this.setDirty(false);
        this.setPreloaded(true);
        return foreignModels;
    }
    /**
     * Runs to array.
     * @returns {Promise<InstanceType<TMC>[]>} - Resolves with the array.
     */
    async toArray() {
        const loadedValue = await this.autoloadOrLoad();
        if (loadedValue === undefined)
            return [];
        return Array.isArray(loadedValue) ? loadedValue : [loadedValue];
    }
    /**
     * Runs size.
     * @returns {Promise<number>} - Resolves with the relationship size, using loaded records when available.
     */
    async size() {
        const loadedValue = this.getLoadedOrUndefined();
        if (loadedValue !== undefined) {
            if (!Array.isArray(loadedValue))
                throw new Error(`Loaded had an unexpected type: ${typeof loadedValue}`);
            return loadedValue.length;
        }
        if (this.getModel().isNewRecord())
            return 0;
        return await this.query().count();
    }
    /**
     * Runs preload.
     * @param {import("../../query/index.js").NestedPreloadRecord} preloads - Preload map for related records.
     * @returns {import("../../query/model-class-query.js").default<TMC>} - The preload.
     */
    preload(preloads) {
        return this.query().clone().preload(preloads);
    }
    /**
     * Runs find.
     * @param {string | number} modelID - Related model identifier.
     * @returns {Promise<InstanceType<TMC>>} - Resolves with the find.
     */
    async find(modelID) {
        return /** @type {Promise<InstanceType<TMC>>} */ (this.query().find(modelID));
    }
    /**
     * Runs query.
     * @returns {import("../../query/model-class-query.js").default<TMC>} - The query.
     */
    query() {
        if (!this.getModel().isPersisted())
            throw new Error("Cannot build a query for an unpersisted parent model");
        const TargetModelClass = this.getTargetModelClass();
        if (!TargetModelClass)
            throw new Error("Cannot load without a target model class");
        const throughRelationshipName = this.getRelationship().through;
        if (throughRelationshipName) {
            const parentModelClass = this.getModel().getModelClass();
            const throughRelationship = parentModelClass.getRelationshipByName(throughRelationshipName);
            const throughModelClass = throughRelationship.getTargetModelClass();
            if (!throughModelClass)
                throw new Error(`Through relationship ${throughRelationshipName} has no target model class`);
            const throughForeignKey = throughRelationship.getForeignKey();
            const throughPrimaryKey = throughRelationship.getPrimaryKey();
            const targetForeignKey = hasManyThroughTargetForeignKey(
            /** @type {import("../relationships/has-many.js").default} */ (this.getRelationship()), throughModelClass, TargetModelClass);
            const targetTable = TargetModelClass.tableName();
            const throughTable = throughModelClass.tableName();
            const baseQuery = this.getModel().queryForModel(TargetModelClass);
            const driver = baseQuery.driver;
            const parentPrimaryKey = this.getPrimaryKey();
            const parentId = /** @type {string | number} */ (this.getModel().readColumn(parentPrimaryKey));
            const joinSql = `LEFT JOIN ${driver.quoteTable(throughTable)} ON ${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughPrimaryKey)} = ${driver.quoteTable(targetTable)}.${driver.quoteColumn(targetForeignKey)}`;
            const whereSql = `${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughForeignKey)} = ${driver.options().quote(parentId)}`;
            const query = baseQuery.joins(joinSql).where(whereSql);
            return this.applyScope(query);
        }
        const foreignKey = this.getForeignKey();
        const primaryKey = this.getPrimaryKey();
        const primaryModelID = /** @type {string | number} */ (this.getModel().readColumn(primaryKey));
        /**
         * Where args.
         * @type {Record<string, string | number>} */
        const whereArgs = {};
        whereArgs[foreignKey] = primaryModelID;
        if (this.getRelationship().getPolymorphic()) {
            const typeColumn = this.getRelationship().getPolymorphicTypeColumn();
            whereArgs[typeColumn] = this.getModel().getModelClass().getModelName();
        }
        const query = this.getModel().queryForModel(TargetModelClass).where(whereArgs);
        return this.applyScope(query);
    }
    /**
     * Runs loaded.
     * @returns {Array<InstanceType<TMC>>} The loaded model or models (depending on relationship type)
     */
    loaded() {
        if (!this._preloaded && this.model.isPersisted()) {
            throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`);
        }
        if (this._loaded === undefined && this.model.isNewRecord()) {
            return [];
        }
        return Array.isArray(this._loaded) ? this._loaded : [];
    }
    /**
     * Runs add to loaded.
     * @param {InstanceType<TMC>[] | InstanceType<TMC>} models - Model instances.
     * @returns {void} - No return value.
     */
    addToLoaded(models) {
        if (!models) {
            throw new Error("Need to give something");
        }
        else if (Array.isArray(models)) {
            for (const model of models) {
                if (this._loaded === undefined) {
                    this._loaded = [model];
                }
                else if (Array.isArray(this._loaded)) {
                    this._loaded.push(model);
                }
                else {
                    throw new Error(`Unexpected loaded type: ${typeof this._loaded}`);
                }
            }
        }
        else {
            if (this._loaded === undefined) {
                this._loaded = [models];
            }
            else if (Array.isArray(this._loaded)) {
                this._loaded.push(models);
            }
            else {
                throw new Error(`Unexpected loaded type: ${typeof this._loaded}`);
            }
        }
    }
    /**
     * Runs set loaded.
     * @param {InstanceType<TMC>[]} models - Model instances.
     * @returns {void} - No return value.
     */
    setLoaded(models) {
        if (!Array.isArray(models))
            throw new Error(`Argument given to setLoaded wasn't an array: ${typeof models}`);
        this._loaded = models;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFzLW1hbnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sd0JBQXdCLE1BQU0sV0FBVyxDQUFBO0FBQ2hELE9BQU8sRUFBQyw4QkFBOEIsRUFBQyxNQUFNLG1DQUFtQyxDQUFBO0FBRWhGOzs7OztHQUtHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxrREFBbUQsU0FBUSx3QkFBd0I7SUFDdEc7OztPQUdHO0lBQ0gsWUFBWSxJQUFJO1FBQ2QsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsSUFBSTtRQUNSLHdDQUF3QztRQUN4QyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBRXhELElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHNEQUFzRCxDQUFDLENBQUE7UUFFOUYsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLGlCQUFpQjtRQUNuRCxnQ0FBZ0MsQ0FBQyxDQUFDLElBQUksZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FDOUQsQ0FBQTtRQUVELG1EQUFtRDtRQUNuRCxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDL0IsSUFBSSxDQUFDLE9BQU8sR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzlCLENBQUM7YUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDaEMsQ0FBQzthQUFNLENBQUM7WUFD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QyxDQUFBO1lBQ25FLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxTQUFTLENBQUMsTUFBTTtRQUNkLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELE9BQU8sTUFBTSxFQUFFLENBQUMsQ0FBQTtRQUU1RyxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQTtJQUN2QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2VJbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCB7aGFzTWFueVRocm91Z2hUYXJnZXRGb3JlaWduS2V5fSBmcm9tIFwiLi4vLi4vcXVlcnkvcHJlbG9hZGVyL2hhcy1tYW55LmpzXCJcblxuLyoqXG4gKiBBIGdlbmVyaWMgcXVlcnkgb3ZlciBzb21lIG1vZGVsIHR5cGUuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBNQ1xuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gVE1DXG4gKiBAYXVnbWVudHMge0Jhc2VJbnN0YW5jZVJlbGF0aW9uc2hpcDxNQywgVE1DPn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRIYXNNYW55SW5zdGFuY2VSZWxhdGlvbnNoaXAgZXh0ZW5kcyBCYXNlSW5zdGFuY2VSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuSW5zdGFuY2VSZWxhdGlvbnNoaXBzQmFzZUFyZ3M8TUMsIFRNQz59IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBzdXBlcihhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQuXG4gICAqIEBwYXJhbSB7Q29uc3RydWN0b3JQYXJhbWV0ZXJzPFRNQz5bMF19IGRhdGEgLSBUYXJnZXQgbW9kZWwgd3JpdGUgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUTUM+fSAtIFRoZSBidWlsZC5cbiAgICovXG4gIGJ1aWxkKGRhdGEpIHtcbiAgICAvLyBTcGF3biBuZXcgbW9kZWwgb2YgdGhlIHRhcmdldGVkIGNsYXNzXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZ2V0Qm91bmRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgYnVpbGQgYSBuZXcgcmVjb3JkIHdpdGhvdXQgYSB0YWdldCBtb2RlbCBjbGFzc1wiKVxuXG4gICAgY29uc3QgbmV3SW5zdGFuY2UgPSB0aGlzLmdldE1vZGVsKCkuYmluZFJlbGF0ZWRSZWNvcmQoXG4gICAgICAvKiogQHR5cGUge0luc3RhbmNlVHlwZTxUTUM+fSAqLyAobmV3IHRhcmdldE1vZGVsQ2xhc3MoZGF0YSkpXG4gICAgKVxuXG4gICAgLy8gQWRkIGl0IHRvIHRoZSBsb2FkZWQgbW9kZWxzIG9mIHRoaXMgcmVsYXRpb25zaGlwXG4gICAgaWYgKHRoaXMuX2xvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9sb2FkZWQgPSBbbmV3SW5zdGFuY2VdXG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHRoaXMuX2xvYWRlZCkpIHtcbiAgICAgIHRoaXMuX2xvYWRlZC5wdXNoKG5ld0luc3RhbmNlKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYExvYWRlZCBoYWQgYW4gdW5leHBlY3RlZCB0eXBlOiAke3R5cGVvZiB0aGlzLl9sb2FkZWR9YClcbiAgICB9XG5cblxuICAgIC8vIFNldCBsb2FkZWQgb24gdGhlIG1vZGVscyBpbnZlcnNlZCByZWxhdGlvbnNoaXBcbiAgICBjb25zdCBpbnZlcnNlT2YgPSB0aGlzLmdldFJlbGF0aW9uc2hpcCgpLmdldEludmVyc2VPZigpXG5cbiAgICBpZiAoaW52ZXJzZU9mKSB7XG4gICAgICBjb25zdCBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXdJbnN0YW5jZS5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoaW52ZXJzZU9mKVxuXG4gICAgICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0QXV0b1NhdmUoZmFsc2UpXG4gICAgICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHRoaXMuZ2V0TW9kZWwoKSlcbiAgICB9XG5cblxuICAgIC8vIEFzc2lnbiB0aGUgZm9yZWlnbiBrZXkgdG8gdGhlIG5ldyBtb2RlbFxuICAgIGNvbnN0IHBhcmVudE1vZGVsID0gdGhpcy5nZXRNb2RlbCgpXG5cbiAgICBpZiAocGFyZW50TW9kZWwuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgY29uc3QgZm9yZWlnbktleU5hbWUgPSB0aGlzLmdldFJlbGF0aW9uc2hpcCgpLmdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe1xuICAgICAgICBtb2RlbENsYXNzOiBwYXJlbnRNb2RlbC5nZXRNb2RlbENsYXNzKCksXG4gICAgICAgIHRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIH0pXG4gICAgICBjb25zdCBjb2x1bW5OYW1lTWFwID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlBdHRyaWJ1dGVOYW1lID0gY29sdW1uTmFtZU1hcFtmb3JlaWduS2V5TmFtZV1cbiAgICAgIGlmICghZm9yZWlnbktleUF0dHJpYnV0ZU5hbWUpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBmb3JlaWduIGtleSBhdHRyaWJ1dGUgbmFtZSBmb3IgJHtmb3JlaWduS2V5TmFtZX1gKVxuICAgICAgY29uc3QgcHJpbWFyeUtleU5hbWUgPSB0aGlzLmdldFByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgZm9yZWlnbktleVZhbHVlID0gcGFyZW50TW9kZWwucmVhZENvbHVtbihwcmltYXJ5S2V5TmFtZSlcbiAgICAgIC8qKlxuICAgICAgICogQXNzaWduIGRhdGEuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgYXNzaWduRGF0YSA9IHt9XG5cbiAgICAgIGFzc2lnbkRhdGFbZm9yZWlnbktleUF0dHJpYnV0ZU5hbWVdID0gZm9yZWlnbktleVZhbHVlXG5cbiAgICAgIG5ld0luc3RhbmNlLmFzc2lnbihhc3NpZ25EYXRhKVxuICAgIH1cblxuXG4gICAgLy8gUmV0dXJuIHRoZSBuZXcgY29udHJ1Y3RlZCBtb2RlbFxuICAgIHJldHVybiBuZXdJbnN0YW5jZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAcGFyYW0ge0NvbnN0cnVjdG9yUGFyYW1ldGVyczxUTUM+WzBdfSBkYXRhIC0gVGFyZ2V0IG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUTUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjcmVhdGUuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoZGF0YSkge1xuICAgIGNvbnN0IG1vZGVsID0gdGhpcy5idWlsZChkYXRhKVxuXG4gICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUTUM+W10+fSAtIFJlc29sdmVzIHdpdGggbG9hZGVkIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgLy8gRm9yY2UtcmVsb2FkOiBkaXNjYXJkIHRoZSBjYWNoZWQgdmFsdWUgYW5kIGZldGNoIGZyZXNoLiBXaGVuIHRoZSBwYXJlbnRcbiAgICAvLyByZWNvcmQgd2FzIGxvYWRlZCBhcyBwYXJ0IG9mIGEgYmF0Y2gsIHJvdXRlIHRocm91Z2ggdGhlIGNvaG9ydCBwcmVsb2FkZXJcbiAgICAvLyBzbyBzaWJsaW5ncyB0aGF0IGhhdmUgbm90IHByZWxvYWRlZCB0aGlzIHJlbGF0aW9uc2hpcCBnZXQgYmF0Y2hlZCB0b28uXG4gICAgLy8gVGhlIHNjb3BlZCBxdWVyeSBwYXRoIChgaW5zdGFuY2UucXVlcnkoKS53aGVyZSguLi4pLmxvYWQoKWApIGJ5cGFzc2VzXG4gICAgLy8gdGhpcyBhbmQgc3RheXMgYSBzaW5nbGUtcmVjb3JkIGxvYWQgYnkgZGVzaWduLlxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkID0gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZCgpXG5cbiAgICBpZiAoYmF0Y2hlZCkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFRNQz5bXX0gKi8gKEFycmF5LmlzQXJyYXkodGhpcy5fbG9hZGVkKSA/IHRoaXMuX2xvYWRlZCA6IFtdKVxuICAgIH1cblxuICAgIGNvbnN0IGZvcmVpZ25Nb2RlbHMgPSAvKiogQHR5cGUge0luc3RhbmNlVHlwZTxUTUM+W119ICovIChhd2FpdCB0aGlzLnF1ZXJ5KCkubG9hZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQoZm9yZWlnbk1vZGVscylcbiAgICB0aGlzLnNldERpcnR5KGZhbHNlKVxuICAgIHRoaXMuc2V0UHJlbG9hZGVkKHRydWUpXG5cbiAgICByZXR1cm4gZm9yZWlnbk1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUTUM+W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFycmF5LlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IGF3YWl0IHRoaXMuYXV0b2xvYWRPckxvYWQoKVxuXG4gICAgaWYgKGxvYWRlZFZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuXG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkobG9hZGVkVmFsdWUpID8gbG9hZGVkVmFsdWUgOiBbbG9hZGVkVmFsdWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaXplLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlbGF0aW9uc2hpcCBzaXplLCB1c2luZyBsb2FkZWQgcmVjb3JkcyB3aGVuIGF2YWlsYWJsZS5cbiAgICovXG4gIGFzeW5jIHNpemUoKSB7XG4gICAgY29uc3QgbG9hZGVkVmFsdWUgPSB0aGlzLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgIGlmIChsb2FkZWRWYWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkobG9hZGVkVmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYExvYWRlZCBoYWQgYW4gdW5leHBlY3RlZCB0eXBlOiAke3R5cGVvZiBsb2FkZWRWYWx1ZX1gKVxuXG4gICAgICByZXR1cm4gbG9hZGVkVmFsdWUubGVuZ3RoXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0TW9kZWwoKS5pc05ld1JlY29yZCgpKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IHByZWxvYWRzIC0gUHJlbG9hZCBtYXAgZm9yIHJlbGF0ZWQgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1DPn0gLSBUaGUgcHJlbG9hZC5cbiAgICovXG4gIHByZWxvYWQocHJlbG9hZHMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmNsb25lKCkucHJlbG9hZChwcmVsb2FkcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBtb2RlbElEIC0gUmVsYXRlZCBtb2RlbCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmluZC5cbiAgICovXG4gIGFzeW5jIGZpbmQobW9kZWxJRCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1Byb21pc2U8SW5zdGFuY2VUeXBlPFRNQz4+fSAqLyAodGhpcy5xdWVyeSgpLmZpbmQobW9kZWxJRCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1DPn0gLSBUaGUgcXVlcnkuXG4gICAqL1xuICBxdWVyeSgpIHtcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWwoKS5pc1BlcnNpc3RlZCgpKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgYnVpbGQgYSBxdWVyeSBmb3IgYW4gdW5wZXJzaXN0ZWQgcGFyZW50IG1vZGVsXCIpXG5cbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gdGhpcy5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghVGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGxvYWQgd2l0aG91dCBhIHRhcmdldCBtb2RlbCBjbGFzc1wiKVxuXG4gICAgY29uc3QgdGhyb3VnaFJlbGF0aW9uc2hpcE5hbWUgPSB0aGlzLmdldFJlbGF0aW9uc2hpcCgpLnRocm91Z2hcblxuICAgIGlmICh0aHJvdWdoUmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgY29uc3QgcGFyZW50TW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWwoKS5nZXRNb2RlbENsYXNzKClcbiAgICAgIGNvbnN0IHRocm91Z2hSZWxhdGlvbnNoaXAgPSBwYXJlbnRNb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZSh0aHJvdWdoUmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRocm91Z2hNb2RlbENsYXNzID0gdGhyb3VnaFJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCF0aHJvdWdoTW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBUaHJvdWdoIHJlbGF0aW9uc2hpcCAke3Rocm91Z2hSZWxhdGlvbnNoaXBOYW1lfSBoYXMgbm8gdGFyZ2V0IG1vZGVsIGNsYXNzYClcblxuICAgICAgY29uc3QgdGhyb3VnaEZvcmVpZ25LZXkgPSB0aHJvdWdoUmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgICAgY29uc3QgdGhyb3VnaFByaW1hcnlLZXkgPSB0aHJvdWdoUmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgdGFyZ2V0Rm9yZWlnbktleSA9IGhhc01hbnlUaHJvdWdoVGFyZ2V0Rm9yZWlnbktleShcbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcCgpKSxcbiAgICAgICAgdGhyb3VnaE1vZGVsQ2xhc3MsXG4gICAgICAgIFRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIClcbiAgICAgIGNvbnN0IHRhcmdldFRhYmxlID0gVGFyZ2V0TW9kZWxDbGFzcy50YWJsZU5hbWUoKVxuICAgICAgY29uc3QgdGhyb3VnaFRhYmxlID0gdGhyb3VnaE1vZGVsQ2xhc3MudGFibGVOYW1lKClcbiAgICAgIGNvbnN0IGJhc2VRdWVyeSA9IHRoaXMuZ2V0TW9kZWwoKS5xdWVyeUZvck1vZGVsKFRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCBkcml2ZXIgPSBiYXNlUXVlcnkuZHJpdmVyXG4gICAgICBjb25zdCBwYXJlbnRQcmltYXJ5S2V5ID0gdGhpcy5nZXRQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IHBhcmVudElkID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovICh0aGlzLmdldE1vZGVsKCkucmVhZENvbHVtbihwYXJlbnRQcmltYXJ5S2V5KSlcbiAgICAgIGNvbnN0IGpvaW5TcWwgPSBgTEVGVCBKT0lOICR7ZHJpdmVyLnF1b3RlVGFibGUodGhyb3VnaFRhYmxlKX0gT04gJHtkcml2ZXIucXVvdGVUYWJsZSh0aHJvdWdoVGFibGUpfS4ke2RyaXZlci5xdW90ZUNvbHVtbih0aHJvdWdoUHJpbWFyeUtleSl9ID0gJHtkcml2ZXIucXVvdGVUYWJsZSh0YXJnZXRUYWJsZSl9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKHRhcmdldEZvcmVpZ25LZXkpfWBcbiAgICAgIGNvbnN0IHdoZXJlU3FsID0gYCR7ZHJpdmVyLnF1b3RlVGFibGUodGhyb3VnaFRhYmxlKX0uJHtkcml2ZXIucXVvdGVDb2x1bW4odGhyb3VnaEZvcmVpZ25LZXkpfSA9ICR7ZHJpdmVyLm9wdGlvbnMoKS5xdW90ZShwYXJlbnRJZCl9YFxuXG4gICAgICBjb25zdCBxdWVyeSA9IGJhc2VRdWVyeS5qb2lucyhqb2luU3FsKS53aGVyZSh3aGVyZVNxbClcblxuICAgICAgcmV0dXJuIHRoaXMuYXBwbHlTY29wZShxdWVyeSlcbiAgICB9XG5cbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRQcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5TW9kZWxJRCA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGhpcy5nZXRNb2RlbCgpLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpXG5cbiAgICAvKipcbiAgICAgKiBXaGVyZSBhcmdzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHdoZXJlQXJncyA9IHt9XG5cbiAgICB3aGVyZUFyZ3NbZm9yZWlnbktleV0gPSBwcmltYXJ5TW9kZWxJRFxuXG4gICAgaWYgKHRoaXMuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UG9seW1vcnBoaWMoKSkge1xuICAgICAgY29uc3QgdHlwZUNvbHVtbiA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UG9seW1vcnBoaWNUeXBlQ29sdW1uKClcblxuICAgICAgd2hlcmVBcmdzW3R5cGVDb2x1bW5dID0gdGhpcy5nZXRNb2RlbCgpLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5nZXRNb2RlbCgpLnF1ZXJ5Rm9yTW9kZWwoVGFyZ2V0TW9kZWxDbGFzcykud2hlcmUod2hlcmVBcmdzKVxuXG4gICAgcmV0dXJuIHRoaXMuYXBwbHlTY29wZShxdWVyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PEluc3RhbmNlVHlwZTxUTUM+Pn0gVGhlIGxvYWRlZCBtb2RlbCBvciBtb2RlbHMgKGRlcGVuZGluZyBvbiByZWxhdGlvbnNoaXAgdHlwZSlcbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCAmJiB0aGlzLm1vZGVsLmlzUGVyc2lzdGVkKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9sb2FkZWQgPT09IHVuZGVmaW5lZCAmJiB0aGlzLm1vZGVsLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHRoaXMuX2xvYWRlZCkgPyB0aGlzLl9sb2FkZWQgOiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHRvIGxvYWRlZC5cbiAgICogQHBhcmFtIHtJbnN0YW5jZVR5cGU8VE1DPltdIHwgSW5zdGFuY2VUeXBlPFRNQz59IG1vZGVscyAtIE1vZGVsIGluc3RhbmNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkVG9Mb2FkZWQobW9kZWxzKSB7XG4gICAgaWYgKCFtb2RlbHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5lZWQgdG8gZ2l2ZSBzb21ldGhpbmdcIilcbiAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobW9kZWxzKSkge1xuICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHMpIHtcbiAgICAgICAgaWYgKHRoaXMuX2xvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5fbG9hZGVkID0gW21vZGVsXVxuICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodGhpcy5fbG9hZGVkKSkge1xuICAgICAgICAgIHRoaXMuX2xvYWRlZC5wdXNoKG1vZGVsKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgdGhpcy5fbG9hZGVkfWApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX2xvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMuX2xvYWRlZCA9IFttb2RlbHNdXG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodGhpcy5fbG9hZGVkKSkge1xuICAgICAgICB0aGlzLl9sb2FkZWQucHVzaChtb2RlbHMpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIHRoaXMuX2xvYWRlZH1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7SW5zdGFuY2VUeXBlPFRNQz5bXX0gbW9kZWxzIC0gTW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRMb2FkZWQobW9kZWxzKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG1vZGVscykpIHRocm93IG5ldyBFcnJvcihgQXJndW1lbnQgZ2l2ZW4gdG8gc2V0TG9hZGVkIHdhc24ndCBhbiBhcnJheTogJHt0eXBlb2YgbW9kZWxzfWApXG5cbiAgICB0aGlzLl9sb2FkZWQgPSBtb2RlbHNcbiAgfVxufVxuIl19