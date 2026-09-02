// @ts-check
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
                const throughId = /** @type {string | number} */ (throughModel.readColumn(throughModelClass.primaryKey()));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFzLW1hbnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvcHJlbG9hZGVyL2hhcy1tYW55LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLDJCQUEyQixNQUFNLHFDQUFxQyxDQUFBO0FBQzdFLE9BQU8sa0JBQWtCLE1BQU0sZ0JBQWdCLENBQUE7QUFDL0MsT0FBTyxvQkFBb0IsRUFBRSxFQUFFLHFCQUFxQixFQUFFLE1BQU0sc0JBQXNCLENBQUE7QUFDbEYsT0FBTyxhQUFhLE1BQU0sbUNBQW1DLENBQUE7QUFFN0Q7Ozs7OztHQU1HO0FBQ0gsTUFBTSxVQUFVLDhCQUE4QixDQUFDLFlBQVksRUFBRSxpQkFBaUIsRUFBRSxnQkFBZ0I7SUFDOUYsNEZBQTRGO0lBQzVGLGlHQUFpRztJQUNqRywrRkFBK0Y7SUFDL0YsTUFBTSxrQkFBa0IsR0FBRyxZQUFZLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtJQUUvRCxJQUFJLGtCQUFrQixFQUFFLENBQUM7UUFDdkIsT0FBTyxnQkFBZ0IsQ0FBQywrQkFBK0IsRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksa0JBQWtCLENBQUE7SUFDckcsQ0FBQztJQUVELEtBQUssTUFBTSxrQkFBa0IsSUFBSSxnQkFBZ0IsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLENBQUM7UUFDckUsSUFBSSxrQkFBa0IsQ0FBQyxPQUFPLEVBQUUsSUFBSSxXQUFXO1lBQUUsU0FBUTtRQUV6RCxNQUFNLDRCQUE0QixHQUFHLGtCQUFrQixDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFN0UsSUFBSSxDQUFDLDRCQUE0QjtZQUFFLFNBQVE7UUFFM0MsSUFBSSw0QkFBNEIsQ0FBQyxpQ0FBaUMsRUFBRSxLQUFLLGlCQUFpQixDQUFDLGlDQUFpQyxFQUFFLEVBQUUsQ0FBQztZQUMvSCxPQUFPLGtCQUFrQixDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtRQUM3SCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sWUFBWSxDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLGlCQUFpQixFQUFFLGdCQUFnQixFQUFDLENBQUMsQ0FBQTtBQUNyRyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQ0FBc0M7SUFDekQ7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ3hELGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsSUFBSSxJQUFJLGtCQUFrQixFQUFFLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxHQUFHO1FBQ1AsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQzlCLE9BQU8sTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDakMsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxVQUFVLENBQUMsZ0JBQWdCLEVBQUUsY0FBYztRQUN6QyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUNoRTs7K0RBRXVEO1FBQ3ZELE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQTtRQUN2Qjs7K0RBRXVEO1FBQ3ZELE1BQU0sZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO1FBRTNCLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ2hDLE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxDQUFDLHFCQUFxQixDQUFDLGdCQUFnQixDQUFDLENBQUE7WUFFMUUsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxFQUFDLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLGNBQWMsRUFBQyxDQUFDLEVBQUUsQ0FBQztnQkFDekYsTUFBTSxNQUFNLEdBQUcsb0JBQW9CLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtnQkFFMUQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztvQkFBRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQTtZQUM3RCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sWUFBWSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUMxQixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sRUFBQyxZQUFZLEVBQUUsZ0JBQWdCLEVBQUMsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFdBQVc7UUFDZixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBRXBELElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRSw2QkFBNkIsQ0FBQyxDQUFBO1FBQ3BJLENBQUM7UUFFRCxNQUFNLHVCQUF1QixHQUFHLHFCQUFxQixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNqRixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUE7UUFDdkQsTUFBTSxtQkFBbUIsR0FBRyxnQkFBZ0IsQ0FBQyxxQkFBcUIsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1FBQzNGLE1BQU0sb0JBQW9CLEdBQUcsbUJBQW1CLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUV0RSxJQUFJLENBQUMsb0JBQW9CO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsdUJBQXVCLDRCQUE0QixDQUFDLENBQUE7UUFFdkgsTUFBTSxpQkFBaUIsR0FBRyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLG9CQUFvQixDQUFDLENBQUE7UUFFbEYsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFFbkUsSUFBSSxDQUFDLG1CQUFtQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseURBQXlELENBQUMsQ0FBQTtRQUVwRyxNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsbUJBQW1CLENBQUMsQ0FBQTtRQUVoRixNQUFNLGdCQUFnQixHQUFHLDhCQUE4QixDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsaUJBQWlCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtRQUMvRyxNQUFNLEVBQUMsWUFBWSxFQUFFLGdCQUFnQixFQUFDLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQTtRQUU5RixJQUFJLFlBQVksQ0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE9BQU8sZ0JBQWdCLENBQUE7UUFFckQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBRTFELE1BQU0sMkJBQTJCLENBQUMsaUJBQWlCLEVBQUUsYUFBYSxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3BGLE1BQU0sMkJBQTJCLENBQUMsZ0JBQWdCLEVBQUUsYUFBYSxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRW5GLE1BQU0saUJBQWlCLEdBQUcsbUJBQW1CLENBQUMsNEJBQTRCLENBQUMsRUFBQyxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsZ0JBQWdCLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1FBRS9JOzswQ0FFa0M7UUFDbEMsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXhDOzs2RkFFcUY7UUFDckYsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUE7UUFFbEM7OzZGQUVxRjtRQUNyRixNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtRQUU3QixLQUFLLE1BQU0sS0FBSyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pDLE1BQU0sZUFBZSxHQUFHLDhCQUE4QixDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1lBRXJGLGtCQUFrQixDQUFDLGVBQWUsQ0FBQyxHQUFHLEVBQUUsQ0FBQTtZQUV4QyxzQkFBc0IsQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUE7WUFDM0MsSUFBSSxDQUFDLENBQUMsZUFBZSxJQUFJLHVCQUF1QixDQUFDO2dCQUFFLHVCQUF1QixDQUFDLGVBQWUsQ0FBQyxHQUFHLEVBQUUsQ0FBQTtZQUVoRyx1QkFBdUIsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDdEQsQ0FBQztRQUVELHFFQUFxRTtRQUNyRSwyRUFBMkU7UUFDM0UsTUFBTSxnQkFBZ0IsR0FBRyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTtRQUM5RSxNQUFNLGFBQWEsR0FBRyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUE7UUFDN0MsTUFBTSxjQUFjLEdBQUcsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEdBQUcsc0JBQXNCLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUU5Sjs7cUVBRTZEO1FBQzdELE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFBO1FBRTVCOzswQ0FFa0M7UUFDbEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUU5QixLQUFLLE1BQU0sTUFBTSxJQUFJLGNBQWMsRUFBRSxDQUFDO1lBQ3BDLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLEtBQUssRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFDLENBQUMsaUJBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBQ2xGLE1BQU0sYUFBYSxHQUFHLE1BQU0sWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBRWxELEtBQUssTUFBTSxZQUFZLElBQUksYUFBYSxFQUFFLENBQUM7Z0JBQ3pDLE1BQU0sUUFBUSxHQUFHLDhCQUE4QixDQUFDLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUE7Z0JBQzVGLE1BQU0sU0FBUyxHQUFHLDhCQUE4QixDQUFDLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLENBQUE7Z0JBRTFHLElBQUksQ0FBQyxDQUFDLFFBQVEsSUFBSSxpQkFBaUIsQ0FBQztvQkFBRSxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFLENBQUE7Z0JBRXRFLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtnQkFDM0MsWUFBWSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUM3QixDQUFDO1FBQ0gsQ0FBQztRQUVELGtGQUFrRjtRQUNsRiwwRUFBMEU7UUFDMUU7OytEQUV1RDtRQUN2RCxJQUFJLFlBQVksR0FBRyxFQUFFLENBQUE7UUFFckIsSUFBSSxZQUFZLENBQUMsSUFBSSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzFCLElBQUksZUFBZSxHQUFHLG9CQUFvQixDQUFDLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1lBRTFFLGVBQWUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsQ0FBQTtZQUMvRCxlQUFlLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsRUFBQyxLQUFLLEVBQUUsZUFBZSxFQUFFLGdCQUFnQixFQUFFLGNBQWMsRUFBRSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsQ0FBQyxDQUFBO1lBRTdILE1BQU0sWUFBWSxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUE7WUFDM0MsTUFBTSxhQUFhLEdBQUcsWUFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLGVBQWUsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBQyxDQUFDLGdCQUFnQixDQUFDLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBRWhKLEtBQUssTUFBTSxNQUFNLElBQUksYUFBYSxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sV0FBVyxHQUFHLGVBQWUsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBQyxDQUFDLGdCQUFnQixDQUFDLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtnQkFDL0UsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtnQkFFckQsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLGlCQUFpQixDQUFDLENBQUE7WUFDekMsQ0FBQztRQUNILENBQUM7UUFFRCw4RUFBOEU7UUFDOUU7OzZGQUVxRjtRQUNyRixNQUFNLHdCQUF3QixHQUFHLEVBQUUsQ0FBQTtRQUVuQyxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sT0FBTyxHQUFHLDhCQUE4QixDQUFDLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUE7WUFFekYsSUFBSSxDQUFDLENBQUMsT0FBTyxJQUFJLHdCQUF3QixDQUFDO2dCQUFFLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQTtZQUVsRix3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDckQsQ0FBQztRQUVELHlEQUF5RDtRQUN6RCxLQUFLLE1BQU0sUUFBUSxJQUFJLGlCQUFpQixFQUFFLENBQUM7WUFDekMsTUFBTSxVQUFVLEdBQUcsaUJBQWlCLENBQUMsUUFBUSxDQUFDLENBQUE7WUFFOUMsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztnQkFDbkMsTUFBTSxlQUFlLEdBQUcsd0JBQXdCLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFBO2dCQUVqRSxLQUFLLE1BQU0sV0FBVyxJQUFJLGVBQWUsRUFBRSxDQUFDO29CQUMxQyxJQUFJLFFBQVEsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO3dCQUNuQyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7b0JBQ2hELENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsS0FBSyxNQUFNLFVBQVUsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1lBQzVDLE1BQU0sbUJBQW1CLEdBQUcsa0JBQWtCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFMUQsS0FBSyxNQUFNLEtBQUssSUFBSSx1QkFBdUIsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUN4RCxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQTtnQkFFOUYsd0VBQXdFO2dCQUN4RSx5RUFBeUU7Z0JBQ3pFLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO2dCQUNoRCxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDdEMsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLFlBQVksQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsVUFBVTtRQUNkLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsYUFBYSxFQUFFLENBQUE7UUFFcEQsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLDZCQUE2QixDQUFDLENBQUE7UUFDcEksQ0FBQztRQUVELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBRW5FLElBQUksQ0FBQyxtQkFBbUI7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUE7UUFFcEcsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ3ZELE1BQU0sZ0JBQWdCLEdBQUcscUJBQXFCLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxtQkFBbUIsQ0FBQyxDQUFBO1FBQ2hGLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsNEJBQTRCLENBQUMsRUFBQyxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsZ0JBQWdCLEVBQUMsQ0FBQyxDQUFBO1FBRW5ILE1BQU0sRUFBQyxZQUFZLEVBQUUsZ0JBQWdCLEVBQUMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQTtRQUV4RixJQUFJLFlBQVksQ0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE9BQU8sZ0JBQWdCLENBQUE7UUFFckQ7OzBDQUVrQztRQUNsQyxNQUFNLHNCQUFzQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFeEM7OzZGQUVxRjtRQUNyRixNQUFNLHVCQUF1QixHQUFHLEVBQUUsQ0FBQTtRQUVsQzs7NkZBRXFGO1FBQ3JGLE1BQU0sa0JBQWtCLEdBQUcsRUFBRSxDQUFBO1FBRTdCLEtBQUssTUFBTSxLQUFLLElBQUksWUFBWSxFQUFFLENBQUM7WUFDakMsTUFBTSxlQUFlLEdBQUcsOEJBQThCLENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7WUFFckYsa0JBQWtCLENBQUMsZUFBZSxDQUFDLEdBQUcsRUFBRSxDQUFBO1lBRXhDLHNCQUFzQixDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQTtZQUMzQyxJQUFJLENBQUMsQ0FBQyxlQUFlLElBQUksdUJBQXVCLENBQUM7Z0JBQUUsdUJBQXVCLENBQUMsZUFBZSxDQUFDLEdBQUcsRUFBRSxDQUFBO1lBRWhHLHVCQUF1QixDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN0RCxDQUFDO1FBRUQsTUFBTSwyQkFBMkIsQ0FBQyxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFMUcsMEVBQTBFO1FBQzFFLGdGQUFnRjtRQUNoRixtREFBbUQ7UUFDbkQsSUFBSSxTQUFTLEdBQUcsb0JBQW9CLENBQUMsWUFBWSxFQUFFLGdCQUFnQixDQUFDLENBQUE7UUFFcEUsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUM7WUFDdkMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1lBRS9ELFNBQVMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEVBQUMsQ0FBQyxVQUFVLENBQUMsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFDLFlBQVksRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUMvRixDQUFDO1FBRUQsU0FBUyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ25ELFNBQVMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsY0FBYyxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUMsQ0FBQyxDQUFBO1FBRTNHOzsrREFFdUQ7UUFDdkQsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFBO1FBQ3ZCLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQUE7UUFDL0IsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEdBQUcsc0JBQXNCLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFDLENBQUMsVUFBVSxDQUFDLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBRWxJLEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7WUFDN0IsTUFBTSxXQUFXLEdBQUcsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFDLENBQUMsVUFBVSxDQUFDLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUNuRSxNQUFNLGlCQUFpQixHQUFHLE1BQU0sV0FBVyxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBRXJELFlBQVksQ0FBQyxJQUFJLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxDQUFBO1FBQ3pDLENBQUM7UUFFRCxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sZUFBZSxHQUFHLDhCQUE4QixDQUFDLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1lBRTNGLGtCQUFrQixDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUN2RCxDQUFDO1FBRUQsS0FBSyxNQUFNLFVBQVUsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1lBQzVDLE1BQU0sbUJBQW1CLEdBQUcsa0JBQWtCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFMUQsS0FBSyxNQUFNLEtBQUssSUFBSSx1QkFBdUIsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUN4RCxNQUFNLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQTtnQkFFOUYsd0VBQXdFO2dCQUN4RSx5RUFBeUU7Z0JBQ3pFLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO2dCQUNoRCxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDdEMsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLFlBQVksQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkIGZyb20gXCIuL2Vuc3VyZS1tb2RlbC1jbGFzcy1pbml0aWFsaXplZC5qc1wiXG5pbXBvcnQgUHJlbG9hZGVyU2VsZWN0aW9uIGZyb20gXCIuL3NlbGVjdGlvbi5qc1wiXG5pbXBvcnQgcHJlbG9hZFF1ZXJ5Rm9yTW9kZWwsIHsgYmluZFByZWxvYWRNb2RlbENsYXNzIH0gZnJvbSBcIi4vcXVlcnktZm9yLW1vZGVsLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSB0YXJnZXQgY29sdW1uIHRoYXQgcmVmZXJlbmNlcyB0aGUgdGhyb3VnaCBtb2RlbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gSGFzLW1hbnkgdGhyb3VnaCByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGhyb3VnaE1vZGVsQ2xhc3MgLSBNb2RlbCB1c2VkIGJ5IHRoZSB0aHJvdWdoIHJlbGF0aW9uc2hpcC5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YXJnZXRNb2RlbENsYXNzIC0gTW9kZWwgbG9hZGVkIGJ5IHRoZSB0aHJvdWdoIHJlbGF0aW9uc2hpcC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRhcmdldCBtb2RlbCBmb3JlaWduIGtleSBjb2x1bW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoYXNNYW55VGhyb3VnaFRhcmdldEZvcmVpZ25LZXkocmVsYXRpb25zaGlwLCB0aHJvdWdoTW9kZWxDbGFzcywgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAvLyBBbiBleHBsaWNpdCBmb3JlaWduIGtleSBvbiB0aGUgaGFzLW1hbnkgbmFtZXMgdGhlIGV4YWN0IHRhcmdldCBjb2x1bW4gdGhhdCByZWZlcmVuY2VzIHRoZVxuICAvLyB0aHJvdWdoIG1vZGVsIOKAlCBob25vciBpdC4gVGhlIHRhcmdldCBjYW4gaGF2ZSBzZXZlcmFsIGJlbG9uZ3MtdG8gcG9pbnRpbmcgYXQgdGhlIHRocm91Z2ggbW9kZWxcbiAgLy8gKGUuZy4gYSBkZWZhdWx0IHBsdXMgYW4gYWx0ZXJuYXRlKSwgc28gcGlja2luZyB0aGUgZmlyc3QgbWF0Y2ggd291bGQgb3RoZXJ3aXNlIGJlIGFtYmlndW91cy5cbiAgY29uc3QgZXhwbGljaXRGb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEV4cGxpY2l0Rm9yZWlnbktleSgpXG5cbiAgaWYgKGV4cGxpY2l0Rm9yZWlnbktleSkge1xuICAgIHJldHVybiB0YXJnZXRNb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtleHBsaWNpdEZvcmVpZ25LZXldIHx8IGV4cGxpY2l0Rm9yZWlnbktleVxuICB9XG5cbiAgZm9yIChjb25zdCB0YXJnZXRSZWxhdGlvbnNoaXAgb2YgdGFyZ2V0TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzKCkpIHtcbiAgICBpZiAodGFyZ2V0UmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldFJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcykgY29udGludWVcblxuICAgIGlmIChyZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpID09PSB0aHJvdWdoTW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSkge1xuICAgICAgcmV0dXJuIHRhcmdldFJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5Rm9yTW9kZWxDbGFzc2VzKHttb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLCB0YXJnZXRNb2RlbENsYXNzOiB0aHJvdWdoTW9kZWxDbGFzc30pXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5Rm9yTW9kZWxDbGFzc2VzKHttb2RlbENsYXNzOiB0aHJvdWdoTW9kZWxDbGFzcywgdGFyZ2V0TW9kZWxDbGFzc30pXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQcmVsb2FkZXJIYXNNYW55IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5tb2RlbHMgLSBNb2RlbCBpbnN0YW5jZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UHJlbG9hZGVyU2VsZWN0aW9ufSBbYXJncy5zZWxlY3Rpb25dIC0gQ29sdW1uIHNlbGVjdGlvbiBhbmQgaWRlbXBvdGVuY3kgcnVsZXMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7bW9kZWxzLCByZWxhdGlvbnNoaXAsIHNlbGVjdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMubW9kZWxzID0gbW9kZWxzXG4gICAgdGhpcy5yZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXBcbiAgICB0aGlzLnNlbGVjdGlvbiA9IHNlbGVjdGlvbiB8fCBuZXcgUHJlbG9hZGVyU2VsZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gTG9hZGVkIHRhcmdldCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBydW4oKSB7XG4gICAgaWYgKHRoaXMucmVsYXRpb25zaGlwLnRocm91Z2gpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5UaHJvdWdoKClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuRGlyZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJ0aXRpb25zIGB0aGlzLm1vZGVsc2AgaW50byB0aG9zZSBhbHJlYWR5IHNhdGlzZmllZCBieSB0aGUgY3VycmVudFxuICAgKiBzZWxlY3Rpb24gKHNraXApIGFuZCB0aG9zZSB0aGF0IHN0aWxsIG5lZWQgbG9hZGluZy4gU2F0aXNmaWVkIG1vZGVscydcbiAgICogYWxyZWFkeS1sb2FkZWQgdGFyZ2V0cyBhcmUgY29sbGVjdGVkIHNvIG5lc3RlZCBwcmVsb2FkcyBrZWVwIHdvcmtpbmcuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBtYXBwaW5nQ29sdW1ucyAtIENvbHVtbnMgcmVxdWlyZWQgZm9yIG1hcHBpbmcgKGZvcmVpZ24ga2V5KS5cbiAgICogQHJldHVybnMge3ttb2RlbHNUb0xvYWQ6IGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10sIHNhdGlzZmllZFRhcmdldHM6IGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119fSAtIFRoZSBwYXJ0aXRpb24uXG4gICAqL1xuICBfcGFydGl0aW9uKHRhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IHRoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKVxuICAgIC8qKlxuICAgICAqIE1vZGVscyB0byBsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IG1vZGVsc1RvTG9hZCA9IFtdXG4gICAgLyoqXG4gICAgICogU2F0aXNmaWVkIHRhcmdldHMuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgY29uc3Qgc2F0aXNmaWVkVGFyZ2V0cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIHRoaXMubW9kZWxzKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAodGhpcy5zZWxlY3Rpb24uaXNTYXRpc2ZpZWQoe2luc3RhbmNlUmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzLCBtYXBwaW5nQ29sdW1uc30pKSB7XG4gICAgICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSBzYXRpc2ZpZWRUYXJnZXRzLnB1c2goLi4ubG9hZGVkKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbW9kZWxzVG9Mb2FkLnB1c2gobW9kZWwpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHttb2RlbHNUb0xvYWQsIHNhdGlzZmllZFRhcmdldHN9XG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZCB0aHJvdWdoIGEgam9pbiB0YWJsZSAoZS5nLiBoYXNNYW55KFwiaW52b2ljZUdyb3Vwc1wiLCB7dGhyb3VnaDogXCJpbnZvaWNlR3JvdXBMaW5rc1wifSkpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBMb2FkZWQgdGFyZ2V0IG1vZGVscy5cbiAgICovXG4gIGFzeW5jIF9ydW5UaHJvdWdoKCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KClcblxuICAgIGlmICghcHJpbWFyeUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMucmVsYXRpb25zaGlwLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gZG9lc24ndCBoYXZlIGEgcHJpbWFyeSBrZXlgKVxuICAgIH1cblxuICAgIGNvbnN0IHRocm91Z2hSZWxhdGlvbnNoaXBOYW1lID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovICh0aGlzLnJlbGF0aW9uc2hpcC50aHJvdWdoKVxuICAgIGNvbnN0IHBhcmVudE1vZGVsQ2xhc3MgPSB0aGlzLm1vZGVsc1swXS5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCB0aHJvdWdoUmVsYXRpb25zaGlwID0gcGFyZW50TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUodGhyb3VnaFJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgcmF3VGhyb3VnaE1vZGVsQ2xhc3MgPSB0aHJvdWdoUmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFyYXdUaHJvdWdoTW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBUaHJvdWdoIHJlbGF0aW9uc2hpcCAke3Rocm91Z2hSZWxhdGlvbnNoaXBOYW1lfSBoYXMgbm8gdGFyZ2V0IG1vZGVsIGNsYXNzYClcblxuICAgIGNvbnN0IHRocm91Z2hNb2RlbENsYXNzID0gYmluZFByZWxvYWRNb2RlbENsYXNzKHRoaXMubW9kZWxzLCByYXdUaHJvdWdoTW9kZWxDbGFzcylcblxuICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIGJlIGdvdHRlbiBmcm9tIHJlbGF0aW9uc2hpcFwiKVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IGJpbmRQcmVsb2FkTW9kZWxDbGFzcyh0aGlzLm1vZGVscywgcmF3VGFyZ2V0TW9kZWxDbGFzcylcblxuICAgIGNvbnN0IHRhcmdldEZvcmVpZ25LZXkgPSBoYXNNYW55VGhyb3VnaFRhcmdldEZvcmVpZ25LZXkodGhpcy5yZWxhdGlvbnNoaXAsIHRocm91Z2hNb2RlbENsYXNzLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IHttb2RlbHNUb0xvYWQsIHNhdGlzZmllZFRhcmdldHN9ID0gdGhpcy5fcGFydGl0aW9uKHRhcmdldE1vZGVsQ2xhc3MsIFt0YXJnZXRGb3JlaWduS2V5XSlcblxuICAgIGlmIChtb2RlbHNUb0xvYWQubGVuZ3RoID09IDApIHJldHVybiBzYXRpc2ZpZWRUYXJnZXRzXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgICBhd2FpdCBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQodGhyb3VnaE1vZGVsQ2xhc3MsIGNvbmZpZ3VyYXRpb24sIG1vZGVsc1RvTG9hZFswXSlcbiAgICBhd2FpdCBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQodGFyZ2V0TW9kZWxDbGFzcywgY29uZmlndXJhdGlvbiwgbW9kZWxzVG9Mb2FkWzBdKVxuXG4gICAgY29uc3QgdGhyb3VnaEZvcmVpZ25LZXkgPSB0aHJvdWdoUmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe21vZGVsQ2xhc3M6IHBhcmVudE1vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3M6IHRocm91Z2hNb2RlbENsYXNzfSlcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBwcmltYXJ5IGtleSB2YWx1ZXMuXG4gICAgICogQHR5cGUge1NldDxudW1iZXIgfCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBieSBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciB8IHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBQcmVsb2FkIGNvbGxlY3Rpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyIHwgc3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4+fSAqL1xuICAgIGNvbnN0IHByZWxvYWRDb2xsZWN0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc1RvTG9hZCkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQ29sdW1uKHByaW1hcnlLZXkpKVxuXG4gICAgICBwcmVsb2FkQ29sbGVjdGlvbnNbcHJpbWFyeUtleVZhbHVlXSA9IFtdXG5cbiAgICAgIG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMuYWRkKHByaW1hcnlLZXlWYWx1ZSlcbiAgICAgIGlmICghKHByaW1hcnlLZXlWYWx1ZSBpbiBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSkpIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW3ByaW1hcnlLZXlWYWx1ZV0gPSBbXVxuXG4gICAgICBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZVtwcmltYXJ5S2V5VmFsdWVdLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgLy8gU3RlcCAxOiBRdWVyeSB0aGUgdGhyb3VnaCB0YWJsZSB0byBidWlsZCBwYXJlbnTihpJ0YXJnZXQgSUQgbWFwcGluZy5cbiAgICAvLyBDaHVuayB0aGUgcGFyZW50IFBLIGNvaG9ydCBzbyB0aGUgdGhyb3VnaCBxdWVyeSdzIElOLWxpc3Qgc3RheXMgYm91bmRlZC5cbiAgICBjb25zdCB0aHJvdWdoQmFzZVF1ZXJ5ID0gcHJlbG9hZFF1ZXJ5Rm9yTW9kZWwobW9kZWxzVG9Mb2FkLCB0aHJvdWdoTW9kZWxDbGFzcylcbiAgICBjb25zdCB0aHJvdWdoRHJpdmVyID0gdGhyb3VnaEJhc2VRdWVyeS5kcml2ZXJcbiAgICBjb25zdCB0aHJvdWdoQ29ob3J0cyA9IHRocm91Z2hEcml2ZXIuY2h1bmtWYWx1ZXMoWy4uLm1vZGVsc1ByaW1hcnlLZXlWYWx1ZXNdLCAoY2h1bmspID0+IHRocm91Z2hCYXNlUXVlcnkuY2xvbmUoKS53aGVyZSh7W3Rocm91Z2hGb3JlaWduS2V5XTogY2h1bmt9KS50b1NxbCgpKVxuXG4gICAgLyoqXG4gICAgICogUGFyZW50IHRvIHRhcmdldCBpZHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcgfCBudW1iZXIsIEFycmF5PHN0cmluZyB8IG51bWJlcj4+fSAqL1xuICAgIGNvbnN0IHBhcmVudFRvVGFyZ2V0SWRzID0ge31cblxuICAgIC8qKlxuICAgICAqIEFsbCB0YXJnZXQgaWRzLlxuICAgICAqIEB0eXBlIHtTZXQ8c3RyaW5nIHwgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBhbGxUYXJnZXRJZHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgY29ob3J0IG9mIHRocm91Z2hDb2hvcnRzKSB7XG4gICAgICBjb25zdCB0aHJvdWdoUXVlcnkgPSB0aHJvdWdoQmFzZVF1ZXJ5LmNsb25lKCkud2hlcmUoe1t0aHJvdWdoRm9yZWlnbktleV06IGNvaG9ydH0pXG4gICAgICBjb25zdCB0aHJvdWdoTW9kZWxzID0gYXdhaXQgdGhyb3VnaFF1ZXJ5LnRvQXJyYXkoKVxuXG4gICAgICBmb3IgKGNvbnN0IHRocm91Z2hNb2RlbCBvZiB0aHJvdWdoTW9kZWxzKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudElkID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovICh0aHJvdWdoTW9kZWwucmVhZENvbHVtbih0aHJvdWdoRm9yZWlnbktleSkpXG4gICAgICAgIGNvbnN0IHRocm91Z2hJZCA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGhyb3VnaE1vZGVsLnJlYWRDb2x1bW4odGhyb3VnaE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpKSlcblxuICAgICAgICBpZiAoIShwYXJlbnRJZCBpbiBwYXJlbnRUb1RhcmdldElkcykpIHBhcmVudFRvVGFyZ2V0SWRzW3BhcmVudElkXSA9IFtdXG5cbiAgICAgICAgcGFyZW50VG9UYXJnZXRJZHNbcGFyZW50SWRdLnB1c2godGhyb3VnaElkKVxuICAgICAgICBhbGxUYXJnZXRJZHMuYWRkKHRocm91Z2hJZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdGVwIDI6IExvYWQgdGFyZ2V0IG1vZGVscyBieSB0aGUgZm9yZWlnbiBrZXkgdGhhdCBwb2ludHMgdG8gdGhlIHRocm91Z2ggdGFibGUuXG4gICAgLy8gQ2h1bmsgdGhlIHRhcmdldCBJRCBjb2hvcnQgc28gdGhlIHRhcmdldCBxdWVyeSdzIElOLWxpc3Qgc3RheXMgYm91bmRlZC5cbiAgICAvKipcbiAgICAgKiBUYXJnZXQgbW9kZWxzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGxldCB0YXJnZXRNb2RlbHMgPSBbXVxuXG4gICAgaWYgKGFsbFRhcmdldElkcy5zaXplID4gMCkge1xuICAgICAgbGV0IHRhcmdldEJhc2VRdWVyeSA9IHByZWxvYWRRdWVyeUZvck1vZGVsKG1vZGVsc1RvTG9hZCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgdGFyZ2V0QmFzZVF1ZXJ5ID0gdGhpcy5yZWxhdGlvbnNoaXAuYXBwbHlTY29wZSh0YXJnZXRCYXNlUXVlcnkpXG4gICAgICB0YXJnZXRCYXNlUXVlcnkgPSB0aGlzLnNlbGVjdGlvbi5hcHBseVRvUXVlcnkoe3F1ZXJ5OiB0YXJnZXRCYXNlUXVlcnksIHRhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zOiBbdGFyZ2V0Rm9yZWlnbktleV19KVxuXG4gICAgICBjb25zdCB0YXJnZXREcml2ZXIgPSB0YXJnZXRCYXNlUXVlcnkuZHJpdmVyXG4gICAgICBjb25zdCB0YXJnZXRDb2hvcnRzID0gdGFyZ2V0RHJpdmVyLmNodW5rVmFsdWVzKFsuLi5hbGxUYXJnZXRJZHNdLCAoY2h1bmspID0+IHRhcmdldEJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbdGFyZ2V0Rm9yZWlnbktleV06IGNodW5rfSkudG9TcWwoKSlcblxuICAgICAgZm9yIChjb25zdCBjb2hvcnQgb2YgdGFyZ2V0Q29ob3J0cykge1xuICAgICAgICBjb25zdCBjb2hvcnRRdWVyeSA9IHRhcmdldEJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbdGFyZ2V0Rm9yZWlnbktleV06IGNvaG9ydH0pXG4gICAgICAgIGNvbnN0IGZvdW5kVGFyZ2V0TW9kZWxzID0gYXdhaXQgY29ob3J0UXVlcnkudG9BcnJheSgpXG5cbiAgICAgICAgdGFyZ2V0TW9kZWxzLnB1c2goLi4uZm91bmRUYXJnZXRNb2RlbHMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU3RlcCAzOiBJbmRleCB0YXJnZXQgbW9kZWxzIGJ5IHRoZWlyIGZvcmVpZ24ga2V5IChtYXBzIHRvIHRocm91Z2ggbW9kZWwgSUQpXG4gICAgLyoqXG4gICAgICogVGFyZ2V0IG1vZGVscyBieSBmb3JlaWduIGtleS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZyB8IG51bWJlciwgQXJyYXk8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCB0YXJnZXRNb2RlbHNCeUZvcmVpZ25LZXkgPSB7fVxuXG4gICAgZm9yIChjb25zdCB0YXJnZXRNb2RlbCBvZiB0YXJnZXRNb2RlbHMpIHtcbiAgICAgIGNvbnN0IGZrVmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKHRhcmdldE1vZGVsLnJlYWRDb2x1bW4odGFyZ2V0Rm9yZWlnbktleSkpXG5cbiAgICAgIGlmICghKGZrVmFsdWUgaW4gdGFyZ2V0TW9kZWxzQnlGb3JlaWduS2V5KSkgdGFyZ2V0TW9kZWxzQnlGb3JlaWduS2V5W2ZrVmFsdWVdID0gW11cblxuICAgICAgdGFyZ2V0TW9kZWxzQnlGb3JlaWduS2V5W2ZrVmFsdWVdLnB1c2godGFyZ2V0TW9kZWwpXG4gICAgfVxuXG4gICAgLy8gU3RlcCA0OiBNYXAgdGFyZ2V0cyB0byBwYXJlbnRzIHZpYSB0aGUgdGhyb3VnaCBtYXBwaW5nXG4gICAgZm9yIChjb25zdCBwYXJlbnRJZCBpbiBwYXJlbnRUb1RhcmdldElkcykge1xuICAgICAgY29uc3QgdGhyb3VnaElkcyA9IHBhcmVudFRvVGFyZ2V0SWRzW3BhcmVudElkXVxuXG4gICAgICBmb3IgKGNvbnN0IHRocm91Z2hJZCBvZiB0aHJvdWdoSWRzKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoaW5nVGFyZ2V0cyA9IHRhcmdldE1vZGVsc0J5Rm9yZWlnbktleVt0aHJvdWdoSWRdIHx8IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCB0YXJnZXRNb2RlbCBvZiBtYXRjaGluZ1RhcmdldHMpIHtcbiAgICAgICAgICBpZiAocGFyZW50SWQgaW4gcHJlbG9hZENvbGxlY3Rpb25zKSB7XG4gICAgICAgICAgICBwcmVsb2FkQ29sbGVjdGlvbnNbcGFyZW50SWRdLnB1c2godGFyZ2V0TW9kZWwpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtb2RlbFZhbHVlIGluIHByZWxvYWRDb2xsZWN0aW9ucykge1xuICAgICAgY29uc3QgcHJlbG9hZGVkQ29sbGVjdGlvbiA9IHByZWxvYWRDb2xsZWN0aW9uc1ttb2RlbFZhbHVlXVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW21vZGVsVmFsdWVdKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHRoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgICAvLyBSZXBsYWNlIHJhdGhlciB0aGFuIGFwcGVuZDogYG1vZGVsc1RvTG9hZGAgYXJlIGV4YWN0bHkgdGhlIHJlY29yZHMgd2VcbiAgICAgICAgLy8gaW50ZW5kIHRvIChyZSlsb2FkLCBzbyBhIGZvcmNlZCByZS1wcmVsb2FkIG11c3Qgbm90IGR1cGxpY2F0ZSBlbnRyaWVzLlxuICAgICAgICBtb2RlbFJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocHJlbG9hZGVkQ29sbGVjdGlvbilcbiAgICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5zYXRpc2ZpZWRUYXJnZXRzLCAuLi50YXJnZXRNb2RlbHNdXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZCBkaXJlY3QgaGFzLW1hbnkgcmVsYXRpb25zaGlwcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gTG9hZGVkIHRhcmdldCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBfcnVuRGlyZWN0KCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KClcblxuICAgIGlmICghcHJpbWFyeUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMucmVsYXRpb25zaGlwLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gZG9lc24ndCBoYXZlIGEgcHJpbWFyeSBrZXlgKVxuICAgIH1cblxuICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIGJlIGdvdHRlbiBmcm9tIHJlbGF0aW9uc2hpcFwiKVxuXG4gICAgY29uc3Qgc291cmNlTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxzWzBdLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBiaW5kUHJlbG9hZE1vZGVsQ2xhc3ModGhpcy5tb2RlbHMsIHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMucmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe21vZGVsQ2xhc3M6IHNvdXJjZU1vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgY29uc3Qge21vZGVsc1RvTG9hZCwgc2F0aXNmaWVkVGFyZ2V0c30gPSB0aGlzLl9wYXJ0aXRpb24odGFyZ2V0TW9kZWxDbGFzcywgW2ZvcmVpZ25LZXldKVxuXG4gICAgaWYgKG1vZGVsc1RvTG9hZC5sZW5ndGggPT0gMCkgcmV0dXJuIHNhdGlzZmllZFRhcmdldHNcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBwcmltYXJ5IGtleSB2YWx1ZXMuXG4gICAgICogQHR5cGUge1NldDxudW1iZXIgfCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMgPSBuZXcgU2V0KClcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBieSBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciB8IHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBQcmVsb2FkIGNvbGxlY3Rpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8bnVtYmVyIHwgc3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4+fSAqL1xuICAgIGNvbnN0IHByZWxvYWRDb2xsZWN0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc1RvTG9hZCkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQ29sdW1uKHByaW1hcnlLZXkpKVxuXG4gICAgICBwcmVsb2FkQ29sbGVjdGlvbnNbcHJpbWFyeUtleVZhbHVlXSA9IFtdXG5cbiAgICAgIG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMuYWRkKHByaW1hcnlLZXlWYWx1ZSlcbiAgICAgIGlmICghKHByaW1hcnlLZXlWYWx1ZSBpbiBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSkpIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW3ByaW1hcnlLZXlWYWx1ZV0gPSBbXVxuXG4gICAgICBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZVtwcmltYXJ5S2V5VmFsdWVdLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgYXdhaXQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKHRhcmdldE1vZGVsQ2xhc3MsIHRoaXMucmVsYXRpb25zaGlwLmdldENvbmZpZ3VyYXRpb24oKSwgbW9kZWxzVG9Mb2FkWzBdKVxuXG4gICAgLy8gQnVpbGQgdGhlIHF1ZXJ5IG9uY2Ugd2l0aCB0aGUgcG9seW1vcnBoaWMgdHlwZSBjb25zdGFudCAod2hlbiBwcmVzZW50KSxcbiAgICAvLyByZWxhdGlvbnNoaXAgc2NvcGUsIGFuZCBzZWxlY3Rpb24uIFRoZSBwYXJlbnQgSUQgSU4tbGlzdCBpcyBjbG9uZWQgcGVyIGNvaG9ydFxuICAgIC8vIHNvIHRoZSBnZW5lcmF0ZWQgU1FMIHN0YXlzIHdpdGhpbiBkcml2ZXIgbGltaXRzLlxuICAgIGxldCBiYXNlUXVlcnkgPSBwcmVsb2FkUXVlcnlGb3JNb2RlbChtb2RlbHNUb0xvYWQsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBpZiAodGhpcy5yZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSkge1xuICAgICAgY29uc3QgdHlwZUNvbHVtbiA9IHRoaXMucmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljVHlwZUNvbHVtbigpXG5cbiAgICAgIGJhc2VRdWVyeSA9IGJhc2VRdWVyeS53aGVyZSh7W3R5cGVDb2x1bW5dOiB0aGlzLnJlbGF0aW9uc2hpcC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKCl9KVxuICAgIH1cblxuICAgIGJhc2VRdWVyeSA9IHRoaXMucmVsYXRpb25zaGlwLmFwcGx5U2NvcGUoYmFzZVF1ZXJ5KVxuICAgIGJhc2VRdWVyeSA9IHRoaXMuc2VsZWN0aW9uLmFwcGx5VG9RdWVyeSh7cXVlcnk6IGJhc2VRdWVyeSwgdGFyZ2V0TW9kZWxDbGFzcywgbWFwcGluZ0NvbHVtbnM6IFtmb3JlaWduS2V5XX0pXG5cbiAgICAvKipcbiAgICAgKiBUYXJnZXQgbW9kZWxzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IHRhcmdldE1vZGVscyA9IFtdXG4gICAgY29uc3QgZHJpdmVyID0gYmFzZVF1ZXJ5LmRyaXZlclxuICAgIGNvbnN0IGNvaG9ydHMgPSBkcml2ZXIuY2h1bmtWYWx1ZXMoWy4uLm1vZGVsc1ByaW1hcnlLZXlWYWx1ZXNdLCAoY2h1bmspID0+IGJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbZm9yZWlnbktleV06IGNodW5rfSkudG9TcWwoKSlcblxuICAgIGZvciAoY29uc3QgY29ob3J0IG9mIGNvaG9ydHMpIHtcbiAgICAgIGNvbnN0IGNvaG9ydFF1ZXJ5ID0gYmFzZVF1ZXJ5LmNsb25lKCkud2hlcmUoe1tmb3JlaWduS2V5XTogY29ob3J0fSlcbiAgICAgIGNvbnN0IGZvdW5kVGFyZ2V0TW9kZWxzID0gYXdhaXQgY29ob3J0UXVlcnkudG9BcnJheSgpXG5cbiAgICAgIHRhcmdldE1vZGVscy5wdXNoKC4uLmZvdW5kVGFyZ2V0TW9kZWxzKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdGFyZ2V0TW9kZWwgb2YgdGFyZ2V0TW9kZWxzKSB7XG4gICAgICBjb25zdCBmb3JlaWduS2V5VmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKHRhcmdldE1vZGVsLnJlYWRDb2x1bW4oZm9yZWlnbktleSkpXG5cbiAgICAgIHByZWxvYWRDb2xsZWN0aW9uc1tmb3JlaWduS2V5VmFsdWVdLnB1c2godGFyZ2V0TW9kZWwpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtb2RlbFZhbHVlIGluIHByZWxvYWRDb2xsZWN0aW9ucykge1xuICAgICAgY29uc3QgcHJlbG9hZGVkQ29sbGVjdGlvbiA9IHByZWxvYWRDb2xsZWN0aW9uc1ttb2RlbFZhbHVlXVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW21vZGVsVmFsdWVdKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHRoaXMucmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgICAvLyBSZXBsYWNlIHJhdGhlciB0aGFuIGFwcGVuZDogYG1vZGVsc1RvTG9hZGAgYXJlIGV4YWN0bHkgdGhlIHJlY29yZHMgd2VcbiAgICAgICAgLy8gaW50ZW5kIHRvIChyZSlsb2FkLCBzbyBhIGZvcmNlZCByZS1wcmVsb2FkIG11c3Qgbm90IGR1cGxpY2F0ZSBlbnRyaWVzLlxuICAgICAgICBtb2RlbFJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocHJlbG9hZGVkQ29sbGVjdGlvbilcbiAgICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5zYXRpc2ZpZWRUYXJnZXRzLCAuLi50YXJnZXRNb2RlbHNdXG4gIH1cbn1cbiJdfQ==