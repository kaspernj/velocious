// @ts-check
import { scalarModelPrimaryKey } from "../../../utils/model-primary-key.js";
import ensureModelClassInitialized from "./ensure-model-class-initialized.js";
import PreloaderSelection from "./selection.js";
import preloadQueryForModel, { bindPreloadModelClass } from "./query-for-model.js";
import restArgsError from "../../../utils/rest-args-error.js";
/**
 * Resolves the target column that references the through model.
 * @param {import("../../record/relationships/has-many.js").default} relationship - Has-many through relationship.
 * @param {typeof import("../../record/index.js").default} throughModelClass - Model used by the through relationship.
 * @param {typeof import("../../record/index.js").default} targetModelClass - Model loaded by the through relationship.
 * @returns {string} Target model foreign key column.
 */
export function hasManyThroughTargetForeignKey(relationship, throughModelClass, targetModelClass) {
    // An explicit foreign key on the has-many names the exact target column that references the
    // through model — honor it. The target can have several belongs-to pointing at the through model
    // (e.g. a default plus an alternate), so picking the first match would otherwise be ambiguous.
    const explicitForeignKey = relationship.getExplicitForeignKey();
    if (explicitForeignKey) {
        return targetModelClass.getAttributeNameToColumnNameMap()[explicitForeignKey] || explicitForeignKey;
    }
    for (const targetRelationship of targetModelClass.getRelationships()) {
        if (targetRelationship.getType() != "belongsTo")
            continue;
        const relationshipTargetModelClass = targetRelationship.getTargetModelClass();
        if (!relationshipTargetModelClass)
            continue;
        if (relationshipTargetModelClass.canonicalRecordMetadataModelClass() === throughModelClass.canonicalRecordMetadataModelClass()) {
            return targetRelationship.getForeignKeyForModelClasses({ modelClass: targetModelClass, targetModelClass: throughModelClass });
        }
    }
    return relationship.getForeignKeyForModelClasses({ modelClass: throughModelClass, targetModelClass });
}
export default class VelociousDatabaseQueryPreloaderHasMany {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../record/index.js").default[]} args.models - Model instances.
     * @param {import("../../record/relationships/has-many.js").default} args.relationship - Relationship.
     * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
     */
    constructor({ models, relationship, selection, ...restArgs }) {
        restArgsError(restArgs);
        this.models = models;
        this.relationship = relationship;
        this.selection = selection || new PreloaderSelection();
    }
    /**
     * Runs run.
     * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
     */
    async run() {
        if (this.relationship.through) {
            return await this._runThrough();
        }
        return await this._runDirect();
    }
    /**
     * Partitions `this.models` into those already satisfied by the current
     * selection (skip) and those that still need loading. Satisfied models'
     * already-loaded targets are collected so nested preloads keep working.
     * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
     * @param {string[]} mappingColumns - Columns required for mapping (foreign key).
     * @returns {{modelsToLoad: import("../../record/index.js").default[], satisfiedTargets: import("../../record/index.js").default[]}} - The partition.
     */
    _partition(targetModelClass, mappingColumns) {
        const relationshipName = this.relationship.getRelationshipName();
        /**
         * Models to load.
         * @type {import("../../record/index.js").default[]} */
        const modelsToLoad = [];
        /**
         * Satisfied targets.
         * @type {import("../../record/index.js").default[]} */
        const satisfiedTargets = [];
        for (const model of this.models) {
            const instanceRelationship = model.getRelationshipByName(relationshipName);
            if (this.selection.isSatisfied({ instanceRelationship, targetModelClass, mappingColumns })) {
                const loaded = instanceRelationship.getLoadedOrUndefined();
                if (Array.isArray(loaded))
                    satisfiedTargets.push(...loaded);
            }
            else {
                modelsToLoad.push(model);
            }
        }
        return { modelsToLoad, satisfiedTargets };
    }
    /**
     * Preload through a join table (e.g. hasMany("invoiceGroups", {through: "invoiceGroupLinks"})).
     * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
     */
    async _runThrough() {
        const primaryKey = this.relationship.getPrimaryKey();
        if (!primaryKey) {
            throw new Error(`${this.relationship.getModelClass().name}#${this.relationship.getRelationshipName()} doesn't have a primary key`);
        }
        const throughRelationshipName = /** @type {string} */ (this.relationship.through);
        const parentModelClass = this.models[0].getModelClass();
        const throughRelationship = parentModelClass.getRelationshipByName(throughRelationshipName);
        const rawThroughModelClass = throughRelationship.getTargetModelClass();
        if (!rawThroughModelClass)
            throw new Error(`Through relationship ${throughRelationshipName} has no target model class`);
        const throughModelClass = bindPreloadModelClass(this.models, rawThroughModelClass);
        const rawTargetModelClass = this.relationship.getTargetModelClass();
        if (!rawTargetModelClass)
            throw new Error("No target model class could be gotten from relationship");
        const targetModelClass = bindPreloadModelClass(this.models, rawTargetModelClass);
        const targetForeignKey = hasManyThroughTargetForeignKey(this.relationship, throughModelClass, targetModelClass);
        const { modelsToLoad, satisfiedTargets } = this._partition(targetModelClass, [targetForeignKey]);
        if (modelsToLoad.length == 0)
            return satisfiedTargets;
        const configuration = this.relationship.getConfiguration();
        await ensureModelClassInitialized(throughModelClass, configuration, modelsToLoad[0]);
        await ensureModelClassInitialized(targetModelClass, configuration, modelsToLoad[0]);
        const throughForeignKey = throughRelationship.getForeignKeyForModelClasses({ modelClass: parentModelClass, targetModelClass: throughModelClass });
        /**
         * Models primary key values.
         * @type {Set<number | string>} */
        const modelsPrimaryKeyValues = new Set();
        /**
         * Models by primary key value.
         * @type {Record<number | string, Array<import("../../record/index.js").default>>} */
        const modelsByPrimaryKeyValue = {};
        /**
         * Preload collections.
         * @type {Record<number | string, Array<import("../../record/index.js").default>>} */
        const preloadCollections = {};
        for (const model of modelsToLoad) {
            const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey));
            preloadCollections[primaryKeyValue] = [];
            modelsPrimaryKeyValues.add(primaryKeyValue);
            if (!(primaryKeyValue in modelsByPrimaryKeyValue))
                modelsByPrimaryKeyValue[primaryKeyValue] = [];
            modelsByPrimaryKeyValue[primaryKeyValue].push(model);
        }
        // Step 1: Query the through table to build parent→target ID mapping.
        // Chunk the parent PK cohort so the through query's IN-list stays bounded.
        const throughBaseQuery = preloadQueryForModel(modelsToLoad, throughModelClass);
        const throughDriver = throughBaseQuery.driver;
        const throughCohorts = throughDriver.chunkValues([...modelsPrimaryKeyValues], (chunk) => throughBaseQuery.clone().where({ [throughForeignKey]: chunk }).toSql());
        /**
         * Parent to target ids.
         * @type {Record<string | number, Array<string | number>>} */
        const parentToTargetIds = {};
        /**
         * All target ids.
         * @type {Set<string | number>} */
        const allTargetIds = new Set();
        for (const cohort of throughCohorts) {
            const throughQuery = throughBaseQuery.clone().where({ [throughForeignKey]: cohort });
            const throughModels = await throughQuery.toArray();
            for (const throughModel of throughModels) {
                const parentId = /** @type {string | number} */ (throughModel.readColumn(throughForeignKey));
                const throughPrimaryKey = scalarModelPrimaryKey(throughModelClass.primaryKey(), `Has-many-through preload for ${throughModelClass.name}`);
                const throughId = /** @type {string | number} */ (throughModel.readColumn(throughPrimaryKey));
                if (!(parentId in parentToTargetIds))
                    parentToTargetIds[parentId] = [];
                parentToTargetIds[parentId].push(throughId);
                allTargetIds.add(throughId);
            }
        }
        // Step 2: Load target models by the foreign key that points to the through table.
        // Chunk the target ID cohort so the target query's IN-list stays bounded.
        /**
         * Target models.
         * @type {import("../../record/index.js").default[]} */
        let targetModels = [];
        if (allTargetIds.size > 0) {
            let targetBaseQuery = preloadQueryForModel(modelsToLoad, targetModelClass);
            targetBaseQuery = this.relationship.applyScope(targetBaseQuery);
            targetBaseQuery = this.selection.applyToQuery({ query: targetBaseQuery, targetModelClass, mappingColumns: [targetForeignKey] });
            const targetDriver = targetBaseQuery.driver;
            const targetCohorts = targetDriver.chunkValues([...allTargetIds], (chunk) => targetBaseQuery.clone().where({ [targetForeignKey]: chunk }).toSql());
            for (const cohort of targetCohorts) {
                const cohortQuery = targetBaseQuery.clone().where({ [targetForeignKey]: cohort });
                const foundTargetModels = await cohortQuery.toArray();
                targetModels.push(...foundTargetModels);
            }
        }
        // Step 3: Index target models by their foreign key (maps to through model ID)
        /**
         * Target models by foreign key.
         * @type {Record<string | number, Array<import("../../record/index.js").default>>} */
        const targetModelsByForeignKey = {};
        for (const targetModel of targetModels) {
            const fkValue = /** @type {string | number} */ (targetModel.readColumn(targetForeignKey));
            if (!(fkValue in targetModelsByForeignKey))
                targetModelsByForeignKey[fkValue] = [];
            targetModelsByForeignKey[fkValue].push(targetModel);
        }
        // Step 4: Map targets to parents via the through mapping
        for (const parentId in parentToTargetIds) {
            const throughIds = parentToTargetIds[parentId];
            for (const throughId of throughIds) {
                const matchingTargets = targetModelsByForeignKey[throughId] || [];
                for (const targetModel of matchingTargets) {
                    if (parentId in preloadCollections) {
                        preloadCollections[parentId].push(targetModel);
                    }
                }
            }
        }
        for (const modelValue in preloadCollections) {
            const preloadedCollection = preloadCollections[modelValue];
            for (const model of modelsByPrimaryKeyValue[modelValue]) {
                const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName());
                // Replace rather than append: `modelsToLoad` are exactly the records we
                // intend to (re)load, so a forced re-preload must not duplicate entries.
                modelRelationship.setLoaded(preloadedCollection);
                modelRelationship.setPreloaded(true);
            }
        }
        return [...satisfiedTargets, ...targetModels];
    }
    /**
     * Preload direct has-many relationships.
     * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
     */
    async _runDirect() {
        const primaryKey = this.relationship.getPrimaryKey();
        if (!primaryKey) {
            throw new Error(`${this.relationship.getModelClass().name}#${this.relationship.getRelationshipName()} doesn't have a primary key`);
        }
        const rawTargetModelClass = this.relationship.getTargetModelClass();
        if (!rawTargetModelClass)
            throw new Error("No target model class could be gotten from relationship");
        const sourceModelClass = this.models[0].getModelClass();
        const targetModelClass = bindPreloadModelClass(this.models, rawTargetModelClass);
        const foreignKey = this.relationship.getForeignKeyForModelClasses({ modelClass: sourceModelClass, targetModelClass });
        const { modelsToLoad, satisfiedTargets } = this._partition(targetModelClass, [foreignKey]);
        if (modelsToLoad.length == 0)
            return satisfiedTargets;
        /**
         * Models primary key values.
         * @type {Set<number | string>} */
        const modelsPrimaryKeyValues = new Set();
        /**
         * Models by primary key value.
         * @type {Record<number | string, Array<import("../../record/index.js").default>>} */
        const modelsByPrimaryKeyValue = {};
        /**
         * Preload collections.
         * @type {Record<number | string, Array<import("../../record/index.js").default>>} */
        const preloadCollections = {};
        for (const model of modelsToLoad) {
            const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey));
            preloadCollections[primaryKeyValue] = [];
            modelsPrimaryKeyValues.add(primaryKeyValue);
            if (!(primaryKeyValue in modelsByPrimaryKeyValue))
                modelsByPrimaryKeyValue[primaryKeyValue] = [];
            modelsByPrimaryKeyValue[primaryKeyValue].push(model);
        }
        await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration(), modelsToLoad[0]);
        // Build the query once with the polymorphic type constant (when present),
        // relationship scope, and selection. The parent ID IN-list is cloned per cohort
        // so the generated SQL stays within driver limits.
        let baseQuery = preloadQueryForModel(modelsToLoad, targetModelClass);
        if (this.relationship.getPolymorphic()) {
            const typeColumn = this.relationship.getPolymorphicTypeColumn();
            baseQuery = baseQuery.where({ [typeColumn]: this.relationship.getModelClass().getModelName() });
        }
        baseQuery = this.relationship.applyScope(baseQuery);
        baseQuery = this.selection.applyToQuery({ query: baseQuery, targetModelClass, mappingColumns: [foreignKey] });
        /**
         * Target models.
         * @type {import("../../record/index.js").default[]} */
        const targetModels = [];
        const driver = baseQuery.driver;
        const cohorts = driver.chunkValues([...modelsPrimaryKeyValues], (chunk) => baseQuery.clone().where({ [foreignKey]: chunk }).toSql());
        for (const cohort of cohorts) {
            const cohortQuery = baseQuery.clone().where({ [foreignKey]: cohort });
            const foundTargetModels = await cohortQuery.toArray();
            targetModels.push(...foundTargetModels);
        }
        for (const targetModel of targetModels) {
            const foreignKeyValue = /** @type {string | number} */ (targetModel.readColumn(foreignKey));
            preloadCollections[foreignKeyValue].push(targetModel);
        }
        for (const modelValue in preloadCollections) {
            const preloadedCollection = preloadCollections[modelValue];
            for (const model of modelsByPrimaryKeyValue[modelValue]) {
                const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName());
                // Replace rather than append: `modelsToLoad` are exactly the records we
                // intend to (re)load, so a forced re-preload must not duplicate entries.
                modelRelationship.setLoaded(preloadedCollection);
                modelRelationship.setPreloaded(true);
            }
        }
        return [...satisfiedTargets, ...targetModels];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFzLW1hbnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvcHJlbG9hZGVyL2hhcy1tYW55LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMscUJBQXFCLEVBQUMsTUFBTSxxQ0FBcUMsQ0FBQTtBQUV6RSxPQUFPLDJCQUEyQixNQUFNLHFDQUFxQyxDQUFBO0FBQzdFLE9BQU8sa0JBQWtCLE1BQU0sZ0JBQWdCLENBQUE7QUFDL0MsT0FBTyxvQkFBb0IsRUFBRSxFQUFFLHFCQUFxQixFQUFFLE1BQU0sc0JBQXNCLENBQUE7QUFDbEYsT0FBTyxhQUFhLE1BQU0sbUNBQW1DLENBQUE7QUFFN0Q7Ozs7OztHQU1HO0FBQ0gsTUFBTSxVQUFVLDhCQUE4QixDQUFDLFlBQVksRUFBRSxpQkFBaUIsRUFBRSxnQkFBZ0I7SUFDOUYsNEZBQTRGO0lBQzVGLGlHQUFpRztJQUNqRywrRkFBK0Y7SUFDL0YsTUFBTSxrQkFBa0IsR0FBRyxZQUFZLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtJQUUvRCxJQUFJLGtCQUFrQixFQUFFLENBQUM7UUFDdkIsT0FBTyxnQkFBZ0IsQ0FBQywrQkFBK0IsRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksa0JBQWtCLENBQUE7SUFDckcsQ0FBQztJQUVELEtBQUssTUFBTSxrQkFBa0IsSUFBSSxnQkFBZ0IsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLENBQUM7UUFDckUsSUFBSSxrQkFBa0IsQ0FBQyxPQUFPLEVBQUUsSUFBSSxXQUFXO1lBQUUsU0FBUTtRQUV6RCxNQUFNLDRCQUE0QixHQUFHLGtCQUFrQixDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFN0UsSUFBSSxDQUFDLDRCQUE0QjtZQUFFLFNBQVE7UUFFM0MsSUFBSSw0QkFBNEIsQ0FBQyxpQ0FBaUMsRUFBRSxLQUFLLGlCQUFpQixDQUFDLGlDQUFpQyxFQUFFLEVBQUUsQ0FBQztZ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Q0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1lBRTNGLGtCQUFrQixDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUN2RCxDQUFDO1FBRUQsS0FBSyxNQUFNLFVBQVUsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1lBQzVDLE1BQU0sbUJBQW1CLEdBQUcsa0JBQWtCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFMUQsS0FBSyxNQUFNLEtBQUssSUFBSSx1QkFBdUIsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUN4RCxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQTtnQkFFOUYsd0VBQXdFO2dCQUN4RSx5RUFBeUU7Z0JBQ3pFLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO2dCQUNoRCxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDdEMsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLFlBQVksQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3NjYWxhck1vZGVsUHJpbWFyeUtleX0gZnJvbSBcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuaW1wb3J0IGVuc3VyZU1vZGVsQ2xhc3NJbml0aWFsaXplZCBmcm9tIFwiLi9lbnN1cmUtbW9kZWwtY2xhc3MtaW5pdGlhbGl6ZWQuanNcIlxuaW1wb3J0IFByZWxvYWRlclNlbGVjdGlvbiBmcm9tIFwiLi9zZWxlY3Rpb24uanNcIlxuaW1wb3J0IHByZWxvYWRRdWVyeUZvck1vZGVsLCB7IGJpbmRQcmVsb2FkTW9kZWxDbGFzcyB9IGZyb20gXCIuL3F1ZXJ5LWZvci1tb2RlbC5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgdGFyZ2V0IGNvbHVtbiB0aGF0IHJlZmVyZW5jZXMgdGhlIHRocm91Z2ggbW9kZWwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3JlY29yZC9yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCIpLmRlZmF1bHR9IHJlbGF0aW9uc2hpcCAtIEhhcy1tYW55IHRocm91Z2ggcmVsYXRpb25zaGlwLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRocm91Z2hNb2RlbENsYXNzIC0gTW9kZWwgdXNlZCBieSB0aGUgdGhyb3VnaCByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGFyZ2V0TW9kZWxDbGFzcyAtIE1vZGVsIGxvYWRlZCBieSB0aGUgdGhyb3VnaCByZWxhdGlvbnNoaXAuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUYXJnZXQgbW9kZWwgZm9yZWlnbiBrZXkgY29sdW1uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaGFzTWFueVRocm91Z2hUYXJnZXRGb3JlaWduS2V5KHJlbGF0aW9uc2hpcCwgdGhyb3VnaE1vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgLy8gQW4gZXhwbGljaXQgZm9yZWlnbiBrZXkgb24gdGhlIGhhcy1tYW55IG5hbWVzIHRoZSBleGFjdCB0YXJnZXQgY29sdW1uIHRoYXQgcmVmZXJlbmNlcyB0aGVcbiAgLy8gdGhyb3VnaCBtb2RlbCDigJQgaG9ub3IgaXQuIFRoZSB0YXJnZXQgY2FuIGhhdmUgc2V2ZXJhbCBiZWxvbmdzLXRvIHBvaW50aW5nIGF0IHRoZSB0aHJvdWdoIG1vZGVsXG4gIC8vIChlLmcuIGEgZGVmYXVsdCBwbHVzIGFuIGFsdGVybmF0ZSksIHNvIHBpY2tpbmcgdGhlIGZpcnN0IG1hdGNoIHdvdWxkIG90aGVyd2lzZSBiZSBhbWJpZ3VvdXMuXG4gIGNvbnN0IGV4cGxpY2l0Rm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRFeHBsaWNpdEZvcmVpZ25LZXkoKVxuXG4gIGlmIChleHBsaWNpdEZvcmVpZ25LZXkpIHtcbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbZXhwbGljaXRGb3JlaWduS2V5XSB8fCBleHBsaWNpdEZvcmVpZ25LZXlcbiAgfVxuXG4gIGZvciAoY29uc3QgdGFyZ2V0UmVsYXRpb25zaGlwIG9mIHRhcmdldE1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwcygpKSB7XG4gICAgaWYgKHRhcmdldFJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3MgPSB0YXJnZXRSZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICBpZiAocmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSA9PT0gdGhyb3VnaE1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkpIHtcbiAgICAgIHJldHVybiB0YXJnZXRSZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleUZvck1vZGVsQ2xhc3Nlcyh7bW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcywgdGFyZ2V0TW9kZWxDbGFzczogdGhyb3VnaE1vZGVsQ2xhc3N9KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleUZvck1vZGVsQ2xhc3Nlcyh7bW9kZWxDbGFzczogdGhyb3VnaE1vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3N9KVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5UHJlbG9hZGVySGFzTWFueSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3MubW9kZWxzIC0gTW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3JlY29yZC9yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1ByZWxvYWRlclNlbGVjdGlvbn0gW2FyZ3Muc2VsZWN0aW9uXSAtIENvbHVtbiBzZWxlY3Rpb24gYW5kIGlkZW1wb3RlbmN5IHJ1bGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe21vZGVscywgcmVsYXRpb25zaGlwLCBzZWxlY3Rpb24sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLm1vZGVscyA9IG1vZGVsc1xuICAgIHRoaXMucmVsYXRpb25zaGlwID0gcmVsYXRpb25zaGlwXG4gICAgdGhpcy5zZWxlY3Rpb24gPSBzZWxlY3Rpb24gfHwgbmV3IFByZWxvYWRlclNlbGVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIExvYWRlZCB0YXJnZXQgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgcnVuKCkge1xuICAgIGlmICh0aGlzLnJlbGF0aW9uc2hpcC50aHJvdWdoKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuVGhyb3VnaCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkRpcmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogUGFydGl0aW9ucyBgdGhpcy5tb2RlbHNgIGludG8gdGhvc2UgYWxyZWFkeSBzYXRpc2ZpZWQgYnkgdGhlIGN1cnJlbnRcbiAgICogc2VsZWN0aW9uIChza2lwKSBhbmQgdGhvc2UgdGhhdCBzdGlsbCBuZWVkIGxvYWRpbmcuIFNhdGlzZmllZCBtb2RlbHMnXG4gICAqIGFscmVhZHktbG9hZGVkIHRhcmdldHMgYXJlIGNvbGxlY3RlZCBzbyBuZXN0ZWQgcHJlbG9hZHMga2VlcCB3b3JraW5nLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gbWFwcGluZ0NvbHVtbnMgLSBDb2x1bW5zIHJlcXVpcmVkIGZvciBtYXBwaW5nIChmb3JlaWduIGtleSkuXG4gICAqIEByZXR1cm5zIHt7bW9kZWxzVG9Mb2FkOiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdLCBzYXRpc2ZpZWRUYXJnZXRzOiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfX0gLSBUaGUgcGFydGl0aW9uLlxuICAgKi9cbiAgX3BhcnRpdGlvbih0YXJnZXRNb2RlbENsYXNzLCBtYXBwaW5nQ29sdW1ucykge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKClcbiAgICAvKipcbiAgICAgKiBNb2RlbHMgdG8gbG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBtb2RlbHNUb0xvYWQgPSBbXVxuICAgIC8qKlxuICAgICAqIFNhdGlzZmllZCB0YXJnZXRzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IHNhdGlzZmllZFRhcmdldHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBtb2RlbCBvZiB0aGlzLm1vZGVscykge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHRoaXMuc2VsZWN0aW9uLmlzU2F0aXNmaWVkKHtpbnN0YW5jZVJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcywgbWFwcGluZ0NvbHVtbnN9KSkge1xuICAgICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkgc2F0aXNmaWVkVGFyZ2V0cy5wdXNoKC4uLmxvYWRlZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1vZGVsc1RvTG9hZC5wdXNoKG1vZGVsKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7bW9kZWxzVG9Mb2FkLCBzYXRpc2ZpZWRUYXJnZXRzfVxuICB9XG5cbiAgLyoqXG4gICAqIFByZWxvYWQgdGhyb3VnaCBhIGpvaW4gdGFibGUgKGUuZy4gaGFzTWFueShcImludm9pY2VHcm91cHNcIiwge3Rocm91Z2g6IFwiaW52b2ljZUdyb3VwTGlua3NcIn0pKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gTG9hZGVkIHRhcmdldCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBfcnVuVGhyb3VnaCgpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0UHJpbWFyeUtleSgpXG5cbiAgICBpZiAoIXByaW1hcnlLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLnJlbGF0aW9uc2hpcC5nZXRNb2RlbENsYXNzKCkubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGRvZXNuJ3QgaGF2ZSBhIHByaW1hcnkga2V5YClcbiAgICB9XG5cbiAgICBjb25zdCB0aHJvdWdoUmVsYXRpb25zaGlwTmFtZSA9IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAodGhpcy5yZWxhdGlvbnNoaXAudGhyb3VnaClcbiAgICBjb25zdCBwYXJlbnRNb2RlbENsYXNzID0gdGhpcy5tb2RlbHNbMF0uZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGhyb3VnaFJlbGF0aW9uc2hpcCA9IHBhcmVudE1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHRocm91Z2hSZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHJhd1Rocm91Z2hNb2RlbENsYXNzID0gdGhyb3VnaFJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGhyb3VnaE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgVGhyb3VnaCByZWxhdGlvbnNoaXAgJHt0aHJvdWdoUmVsYXRpb25zaGlwTmFtZX0gaGFzIG5vIHRhcmdldCBtb2RlbCBjbGFzc2ApXG5cbiAgICBjb25zdCB0aHJvdWdoTW9kZWxDbGFzcyA9IGJpbmRQcmVsb2FkTW9kZWxDbGFzcyh0aGlzLm1vZGVscywgcmF3VGhyb3VnaE1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIk5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb3VsZCBiZSBnb3R0ZW4gZnJvbSByZWxhdGlvbnNoaXBcIilcblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBiaW5kUHJlbG9hZE1vZGVsQ2xhc3ModGhpcy5tb2RlbHMsIHJhd1RhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBjb25zdCB0YXJnZXRGb3JlaWduS2V5ID0gaGFzTWFueVRocm91Z2hUYXJnZXRGb3JlaWduS2V5KHRoaXMucmVsYXRpb25zaGlwLCB0aHJvdWdoTW9kZWxDbGFzcywgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICBjb25zdCB7bW9kZWxzVG9Mb2FkLCBzYXRpc2ZpZWRUYXJnZXRzfSA9IHRoaXMuX3BhcnRpdGlvbih0YXJnZXRNb2RlbENsYXNzLCBbdGFyZ2V0Rm9yZWlnbktleV0pXG5cbiAgICBpZiAobW9kZWxzVG9Mb2FkLmxlbmd0aCA9PSAwKSByZXR1cm4gc2F0aXNmaWVkVGFyZ2V0c1xuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMucmVsYXRpb25zaGlwLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgYXdhaXQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKHRocm91Z2hNb2RlbENsYXNzLCBjb25maWd1cmF0aW9uLCBtb2RlbHNUb0xvYWRbMF0pXG4gICAgYXdhaXQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKHRhcmdldE1vZGVsQ2xhc3MsIGNvbmZpZ3VyYXRpb24sIG1vZGVsc1RvTG9hZFswXSlcblxuICAgIGNvbnN0IHRocm91Z2hGb3JlaWduS2V5ID0gdGhyb3VnaFJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5Rm9yTW9kZWxDbGFzc2VzKHttb2RlbENsYXNzOiBwYXJlbnRNb2RlbENsYXNzLCB0YXJnZXRNb2RlbENsYXNzOiB0aHJvdWdoTW9kZWxDbGFzc30pXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbHMgcHJpbWFyeSBrZXkgdmFsdWVzLlxuICAgICAqIEB0eXBlIHtTZXQ8bnVtYmVyIHwgc3RyaW5nPn0gKi9cbiAgICBjb25zdCBtb2RlbHNQcmltYXJ5S2V5VmFsdWVzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbHMgYnkgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAgICogQHR5cGUge1JlY29yZDxudW1iZXIgfCBzdHJpbmcsIEFycmF5PGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pj59ICovXG4gICAgY29uc3QgbW9kZWxzQnlQcmltYXJ5S2V5VmFsdWUgPSB7fVxuXG4gICAgLyoqXG4gICAgICogUHJlbG9hZCBjb2xsZWN0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciB8IHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCBwcmVsb2FkQ29sbGVjdGlvbnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHNUb0xvYWQpIHtcbiAgICAgIGNvbnN0IHByaW1hcnlLZXlWYWx1ZSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAobW9kZWwucmVhZENvbHVtbihwcmltYXJ5S2V5KSlcblxuICAgICAgcHJlbG9hZENvbGxlY3Rpb25zW3ByaW1hcnlLZXlWYWx1ZV0gPSBbXVxuXG4gICAgICBtb2RlbHNQcmltYXJ5S2V5VmFsdWVzLmFkZChwcmltYXJ5S2V5VmFsdWUpXG4gICAgICBpZiAoIShwcmltYXJ5S2V5VmFsdWUgaW4gbW9kZWxzQnlQcmltYXJ5S2V5VmFsdWUpKSBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZVtwcmltYXJ5S2V5VmFsdWVdID0gW11cblxuICAgICAgbW9kZWxzQnlQcmltYXJ5S2V5VmFsdWVbcHJpbWFyeUtleVZhbHVlXS5wdXNoKG1vZGVsKVxuICAgIH1cblxuICAgIC8vIFN0ZXAgMTogUXVlcnkgdGhlIHRocm91Z2ggdGFibGUgdG8gYnVpbGQgcGFyZW504oaSdGFyZ2V0IElEIG1hcHBpbmcuXG4gICAgLy8gQ2h1bmsgdGhlIHBhcmVudCBQSyBjb2hvcnQgc28gdGhlIHRocm91Z2ggcXVlcnkncyBJTi1saXN0IHN0YXlzIGJvdW5kZWQuXG4gICAgY29uc3QgdGhyb3VnaEJhc2VRdWVyeSA9IHByZWxvYWRRdWVyeUZvck1vZGVsKG1vZGVsc1RvTG9hZCwgdGhyb3VnaE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgdGhyb3VnaERyaXZlciA9IHRocm91Z2hCYXNlUXVlcnkuZHJpdmVyXG4gICAgY29uc3QgdGhyb3VnaENvaG9ydHMgPSB0aHJvdWdoRHJpdmVyLmNodW5rVmFsdWVzKFsuLi5tb2RlbHNQcmltYXJ5S2V5VmFsdWVzXSwgKGNodW5rKSA9PiB0aHJvdWdoQmFzZVF1ZXJ5LmNsb25lKCkud2hlcmUoe1t0aHJvdWdoRm9yZWlnbktleV06IGNodW5rfSkudG9TcWwoKSlcblxuICAgIC8qKlxuICAgICAqIFBhcmVudCB0byB0YXJnZXQgaWRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nIHwgbnVtYmVyLCBBcnJheTxzdHJpbmcgfCBudW1iZXI+Pn0gKi9cbiAgICBjb25zdCBwYXJlbnRUb1RhcmdldElkcyA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBBbGwgdGFyZ2V0IGlkcy5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZyB8IG51bWJlcj59ICovXG4gICAgY29uc3QgYWxsVGFyZ2V0SWRzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGNvaG9ydCBvZiB0aHJvdWdoQ29ob3J0cykge1xuICAgICAgY29uc3QgdGhyb3VnaFF1ZXJ5ID0gdGhyb3VnaEJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbdGhyb3VnaEZvcmVpZ25LZXldOiBjb2hvcnR9KVxuICAgICAgY29uc3QgdGhyb3VnaE1vZGVscyA9IGF3YWl0IHRocm91Z2hRdWVyeS50b0FycmF5KClcblxuICAgICAgZm9yIChjb25zdCB0aHJvdWdoTW9kZWwgb2YgdGhyb3VnaE1vZGVscykge1xuICAgICAgICBjb25zdCBwYXJlbnRJZCA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGhyb3VnaE1vZGVsLnJlYWRDb2x1bW4odGhyb3VnaEZvcmVpZ25LZXkpKVxuICAgICAgICBjb25zdCB0aHJvdWdoUHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleSh0aHJvdWdoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBIYXMtbWFueS10aHJvdWdoIHByZWxvYWQgZm9yICR7dGhyb3VnaE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgICBjb25zdCB0aHJvdWdoSWQgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKHRocm91Z2hNb2RlbC5yZWFkQ29sdW1uKHRocm91Z2hQcmltYXJ5S2V5KSlcblxuICAgICAgICBpZiAoIShwYXJlbnRJZCBpbiBwYXJlbnRUb1RhcmdldElkcykpIHBhcmVudFRvVGFyZ2V0SWRzW3BhcmVudElkXSA9IFtdXG5cbiAgICAgICAgcGFyZW50VG9UYXJnZXRJZHNbcGFyZW50SWRdLnB1c2godGhyb3VnaElkKVxuICAgICAgICBhbGxUYXJnZXRJZHMuYWRkKHRocm91Z2hJZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdGVwIDI6IExvYWQgdGFyZ2V0IG1vZGVscyBieSB0aGUgZm9yZWlnbiBrZXkgdGhhdCBwb2ludHMgdG8gdGhlIHRocm91Z2ggdGFibGUuXG4gICAgLy8gQ2h1bmsgdGhlIHRhcmdldCBJRCBjb2hvcnQgc28gdGhlIHRhcmdldCBxdWVyeSdzIElOLWxpc3Qgc3RheXMgYm91bmRlZC5cbiAgICAvKipcbiAgICAgKiBUYXJnZXQgbW9kZWxzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGxldCB0YXJnZXRNb2RlbHMgPSBbXVxuXG4gICAgaWYgKGFsbFRhcmdldElkcy5zaXplID4gMCkge1xuICAgICAgbGV0IHRhcmdldEJhc2VRdWVyeSA9IHByZWxvYWRRdWVyeUZvck1vZGVsKG1vZGVsc1RvTG9hZCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgdGFyZ2V0QmFzZVF1ZXJ5ID0gdGhpcy5yZWxhdGlvbnNoaXAuYXBwbHlTY29wZSh0YXJnZXRCYXNlUXVlcnkpXG4gICAgICB0YXJnZXRCYXNlUXVlcnkgPSB0aGlzLnNlbGVjdGlvbi5hcHBseVRvUXVlcnkoe3F1ZXJ5OiB0YXJnZXRCYXNlUXVlcnksIHRhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zOiBbdGFyZ2V0Rm9yZWlnbktleV19KVxuXG4gICAgICBjb25zdCB0YXJnZXREcml2ZXIgPSB0YXJnZXRCYXNlUXVlcnkuZHJpdmVyXG4gICAgICBjb25zdCB0YXJnZXRDb2hvcnRzID0gdGFyZ2V0RHJpdmVyLmNodW5rVmFsdWVzKFsuLi5hbGxUYXJnZXRJZHNdLCAoY2h1bmspID0+IHRhcmdldEJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbdGFyZ2V0Rm9yZWlnbktleV06IGNodW5rfSkudG9TcWwoKSlcblxuICAgICAgZm9yIChjb25zdCBjb2hvcnQgb2YgdGFyZ2V0Q29ob3J0cykge1xuICAgICAgICBjb25zdCBjb2hvcnRRdWVyeSA9IHRhcmdldEJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbdGFyZ2V0Rm9yZWlnbktleV06IGNvaG9ydH0pXG4gICAgICAgIGNvbnN0IGZvdW5kVGFyZ2V0TW9kZWxzID0gYXdhaXQgY29ob3J0UXVlcnkudG9BcnJheSgpXG5cbiAgICAgICAgdGFyZ2V0TW9kZWxzLnB1c2goLi4uZm91bmRUYXJnZXRNb2RlbHMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU3RlcCAzOiBJbmRleCB0YXJnZXQgbW9kZWxzIGJ5IHRoZWlyIGZvcmVpZ24ga2V5IChtYXBzIHRvIHRocm91Z2ggbW9kZWwgSUQpXG4gICAgLyoqXG4gICAgICogVGFyZ2V0IG1vZGVscyBieSBmb3JlaWduIGtleS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZyB8IG51bWJlciwgQXJyYXk8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCB0YXJnZXRNb2RlbHNCeUZvcmVpZ25LZXkgPSB7fVxuXG4gICAgZm9yIChjb25zdCB0YXJnZXRNb2RlbCBvZiB0YXJnZXRNb2RlbHMpIHtcbiAgICAgIGNvbnN0IGZrVmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKHRhcmdldE1vZGVsLnJlYWRDb2x1bW4odGFyZ2V0Rm9yZWlnbktleSkpXG5cbiAgICAgIGlmICghKGZrVmFsdWUgaW4gdGFyZ2V0TW9kZWxzQnlGb3JlaWduS2V5KSkgdGFyZ2V0TW9kZWxzQnlGb3JlaWduS2V5W2ZrVmFsdWVdID0gW11cblxuICAgICAgdGFyZ2V0TW9kZWxzQnlGb3JlaWduS2V5W2ZrVmFsdWVdLnB1c2godGFyZ2V0TW9kZWwpXG4gICAgfVxuXG4gICAgLy8gU3RlcCA0OiBNYXAgdGFyZ2V0cyB0byBwYXJlbnRzIHZpYSB0aGUgdGhyb3VnaCBtYXBwaW5nXG4gICAgZm9yIChjb25zdCBwYXJlbnRJZCBpbiBwYXJlbnRUb1RhcmdldElkcykge1xuICAgICAgY29uc3QgdGhyb3VnaElkcyA9IHBhcmVudFRvVGFyZ2V0SWRzW3BhcmVudElkXVxuXG4gICAgICBmb3IgKGNvbnN0IHRocm91Z2hJZCBvZiB0aHJvdWdoSWRzKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoaW5nVGFyZ2V0cyA9IHRhcmdldE1vZGVsc0J5Rm9yZWlnbktleVt0aHJvdWdoSWRdIHx8IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCB0YXJnZXRNb2RlbCBvZiBtYXRjaGluZ1RhcmdldHMpIHtcbiAgICAgICAgICBpZiAocGFyZW50SWQgaW4gcHJlbG9hZENvbGxlY3Rpb25zKSB7XG4gICAgICAgICAgICBwcmVsb2FkQ29sbGVjdGlvbnNbcGFyZW50SWRdLnB1c2godGFyZ2V0TW9kZWwpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtb2RlbFZhbHVlIGluIHByZWxvYWRDb2xsZWN0aW9ucykge1xuICAgICAgY29uc3QgcHJlbG9hZGVkQ29sbGVjdGlvbiA9IHByZWxvYWRDb2xsZWN0aW9uc1ttb2RlbFZhbHVlXVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW21vZGVsVmFsdWVdKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHRoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgICAvLyBSZXBsYWNlIHJhdGhlciB0aGFuIGFwcGVuZDogYG1vZGVsc1RvTG9hZGAgYXJlIGV4YWN0bHkgdGhlIHJlY29yZHMgd2VcbiAgICAgICAgLy8gaW50ZW5kIHRvIChyZSlsb2FkLCBzbyBhIGZvcmNlZCByZS1wcmVsb2FkIG11c3Qgbm90IGR1cGxpY2F0ZSBlbnRyaWVzLlxuICAgICAgICBtb2RlbFJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocHJlbG9hZGVkQ29sbGVjdGlvbilcbiAgICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5zYXRpc2ZpZWRUYXJnZXRzLCAuLi50YXJnZXRNb2RlbHNdXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZCBkaXJlY3QgaGFzLW1hbnkgcmVsYXRpb25zaGlwcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gTG9hZGVkIHRhcmdldCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBfcnVuRGlyZWN0KCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KClcblxuICAgIGlmICghcHJpbWFyeUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMucmVsYXRpb25zaGlwLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gZG9lc24ndCBoYXZlIGEgcHJpbWFyeSBrZXlgKVxuICAgIH1cblxuICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIGJlIGdvdHRlbiBmcm9tIHJlbGF0aW9uc2hpcFwiKVxuXG4gICAgY29uc3Qgc291cmNlTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxzWzBdLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBiaW5kUHJlbG9hZE1vZGVsQ2xhc3ModGhpcy5tb2RlbHMsIHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMucmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe21vZGVsQ2xhc3M6IHNvdXJjZU1vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgY29uc3Qge21vZGVsc1RvTG9hZCwgc2F0aXNmaWVkVGFyZ2V0c30gPSB0aGlzLl9wYXJ0aXRpb24odGFyZ2V0TW9kZWxDbGFzcywgW2ZvcmVpZ25LZXldKVxuXG4gICAgaWYgKG1vZGVsc1RvTG9hZC5sZW5ndGggPT0gMCkgcmV0dXJuIHNhdGlzZmllZFRhcmdldHNcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBwcmltYXJ5IGtleSB2YWx1ZXMuXG4gICAgICogQHR5cGUge1NldDxudW1iZXIgfCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBieSBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciB8IHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBQcmVsb2FkIGNvbGxlY3Rpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyIHwgc3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4+fSAqL1xuICAgIGNvbnN0IHByZWxvYWRDb2xsZWN0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc1RvTG9hZCkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQ29sdW1uKHByaW1hcnlLZXkpKVxuXG4gICAgICBwcmVsb2FkQ29sbGVjdGlvbnNbcHJpbWFyeUtleVZhbHVlXSA9IFtdXG5cbiAgICAgIG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMuYWRkKHByaW1hcnlLZXlWYWx1ZSlcbiAgICAgIGlmICghKHByaW1hcnlLZXlWYWx1ZSBpbiBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSkpIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW3ByaW1hcnlLZXlWYWx1ZV0gPSBbXVxuXG4gICAgICBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZVtwcmltYXJ5S2V5VmFsdWVdLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgYXdhaXQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKHRhcmdldE1vZGVsQ2xhc3MsIHRoaXMucmVsYXRpb25zaGlwLmdldENvbmZpZ3VyYXRpb24oKSwgbW9kZWxzVG9Mb2FkWzBdKVxuXG4gICAgLy8gQnVpbGQgdGhlIHF1ZXJ5IG9uY2Ugd2l0aCB0aGUgcG9seW1vcnBoaWMgdHlwZSBjb25zdGFudCAod2hlbiBwcmVzZW50KSxcbiAgICAvLyByZWxhdGlvbnNoaXAgc2NvcGUsIGFuZCBzZWxlY3Rpb24uIFRoZSBwYXJlbnQgSUQgSU4tbGlzdCBpcyBjbG9uZWQgcGVyIGNvaG9ydFxuICAgIC8vIHNvIHRoZSBnZW5lcmF0ZWQgU1FMIHN0YXlzIHdpdGhpbiBkcml2ZXIgbGltaXRzLlxuICAgIGxldCBiYXNlUXVlcnkgPSBwcmVsb2FkUXVlcnlGb3JNb2RlbChtb2RlbHNUb0xvYWQsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBpZiAodGhpcy5yZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSkge1xuICAgICAgY29uc3QgdHlwZUNvbHVtbiA9IHRoaXMucmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljVHlwZUNvbHVtbigpXG5cbiAgICAgIGJhc2VRdWVyeSA9IGJhc2VRdWVyeS53aGVyZSh7W3R5cGVDb2x1bW5dOiB0aGlzLnJlbGF0aW9uc2hpcC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKCl9KVxuICAgIH1cblxuICAgIGJhc2VRdWVyeSA9IHRoaXMucmVsYXRpb25zaGlwLmFwcGx5U2NvcGUoYmFzZVF1ZXJ5KVxuICAgIGJhc2VRdWVyeSA9IHRoaXMuc2VsZWN0aW9uLmFwcGx5VG9RdWVyeSh7cXVlcnk6IGJhc2VRdWVyeSwgdGFyZ2V0TW9kZWxDbGFzcywgbWFwcGluZ0NvbHVtbnM6IFtmb3JlaWduS2V5XX0pXG5cbiAgICAvKipcbiAgICAgKiBUYXJnZXQgbW9kZWxzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IHRhcmdldE1vZGVscyA9IFtdXG4gICAgY29uc3QgZHJpdmVyID0gYmFzZVF1ZXJ5LmRyaXZlclxuICAgIGNvbnN0IGNvaG9ydHMgPSBkcml2ZXIuY2h1bmtWYWx1ZXMoWy4uLm1vZGVsc1ByaW1hcnlLZXlWYWx1ZXNdLCAoY2h1bmspID0+IGJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbZm9yZWlnbktleV06IGNodW5rfSkudG9TcWwoKSlcblxuICAgIGZvciAoY29uc3QgY29ob3J0IG9mIGNvaG9ydHMpIHtcbiAgICAgIGNvbnN0IGNvaG9ydFF1ZXJ5ID0gYmFzZVF1ZXJ5LmNsb25lKCkud2hlcmUoe1tmb3JlaWduS2V5XTogY29ob3J0fSlcbiAgICAgIGNvbnN0IGZvdW5kVGFyZ2V0TW9kZWxzID0gYXdhaXQgY29ob3J0UXVlcnkudG9BcnJheSgpXG5cbiAgICAgIHRhcmdldE1vZGVscy5wdXNoKC4uLmZvdW5kVGFyZ2V0TW9kZWxzKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdGFyZ2V0TW9kZWwgb2YgdGFyZ2V0TW9kZWxzKSB7XG4gICAgICBjb25zdCBmb3JlaWduS2V5VmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKHRhcmdldE1vZGVsLnJlYWRDb2x1bW4oZm9yZWlnbktleSkpXG5cbiAgICAgIHByZWxvYWRDb2xsZWN0aW9uc1tmb3JlaWduS2V5VmFsdWVdLnB1c2godGFyZ2V0TW9kZWwpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtb2RlbFZhbHVlIGluIHByZWxvYWRDb2xsZWN0aW9ucykge1xuICAgICAgY29uc3QgcHJlbG9hZGVkQ29sbGVjdGlvbiA9IHByZWxvYWRDb2xsZWN0aW9uc1ttb2RlbFZhbHVlXVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW21vZGVsVmFsdWVdKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHRoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgICAvLyBSZXBsYWNlIHJhdGhlciB0aGFuIGFwcGVuZDogYG1vZGVsc1RvTG9hZGAgYXJlIGV4YWN0bHkgdGhlIHJlY29yZHMgd2VcbiAgICAgICAgLy8gaW50ZW5kIHRvIChyZSlsb2FkLCBzbyBhIGZvcmNlZCByZS1wcmVsb2FkIG11c3Qgbm90IGR1cGxpY2F0ZSBlbnRyaWVzLlxuICAgICAgICBtb2RlbFJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocHJlbG9hZGVkQ29sbGVjdGlvbilcbiAgICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5zYXRpc2ZpZWRUYXJnZXRzLCAuLi50YXJnZXRNb2RlbHNdXG4gIH1cbn1cbiJdfQ==