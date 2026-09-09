// @ts-check
import ensureModelClassInitialized from "./ensure-model-class-initialized.js";
import PreloaderSelection from "./selection.js";
import preloadQueryForModel, { bindPreloadModelClass } from "./query-for-model.js";
import restArgsError from "../../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryPreloaderBelongsTo {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../record/index.js").default[]} args.models - Model instances.
     * @param {import("../../record/relationships/belongs-to.js").default} args.relationship - Relationship.
     * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
     */
    constructor({ models, relationship, selection, ...restArgs }) {
        restArgsError(restArgs);
        this.models = models;
        this.relationship = relationship;
        this.selection = selection || new PreloaderSelection();
    }
    async run() {
        const sourceModelClass = this.models[0].getModelClass();
        const foreignKey = this.relationship.getForeignKeyForModelClasses({ modelClass: sourceModelClass, targetModelClass: sourceModelClass });
        const primaryKey = this.relationship.getPrimaryKey();
        const relationshipName = this.relationship.getRelationshipName();
        if (this.relationship.getPolymorphic()) {
            return await this._runPolymorphic({ foreignKey, primaryKey, relationshipName });
        }
        const rawTargetModelClass = this.relationship.getTargetModelClass();
        if (!rawTargetModelClass)
            throw new Error("No target model class could be gotten from relationship");
        const targetModelClass = bindPreloadModelClass(this.models, rawTargetModelClass);
        /**
         * Satisfied targets.
         * @type {import("../../record/index.js").default[]} */
        const satisfiedTargets = [];
        /**
         * Models to load.
         * @type {import("../../record/index.js").default[]} */
        const modelsToLoad = [];
        for (const model of this.models) {
            const instanceRelationship = model.getRelationshipByName(relationshipName);
            if (this.selection.isSatisfied({ instanceRelationship, targetModelClass, mappingColumns: [primaryKey] })) {
                const loaded = /** @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined());
                if (loaded)
                    satisfiedTargets.push(loaded);
            }
            else {
                modelsToLoad.push(model);
            }
        }
        if (modelsToLoad.length == 0)
            return satisfiedTargets;
        /**
         * Foreign key values.
         * @type {Set<number | string>} */
        const foreignKeyValues = new Set();
        for (const model of modelsToLoad) {
            const foreignKeyValue = /** @type {string | number | null | undefined} */ (model.readColumn(foreignKey));
            // Skip null/undefined foreign keys: a belongsTo with no foreign key has no
            // target, and including them would serialize to e.g. `IN (null)` which
            // throws on non-string primary-key columns.
            if (foreignKeyValue === null || foreignKeyValue === undefined)
                continue;
            foreignKeyValues.add(foreignKeyValue);
        }
        /**
         * Target models by id.
         * @type {Record<string, import("../../record/index.js").default>} */
        const targetModelsById = {};
        /**
         * Target models.
         * @type {import("../../record/index.js").default[]} */
        let targetModels = [];
        // Only query when at least one model has a non-null foreign key.
        if (foreignKeyValues.size > 0) {
            await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration(), modelsToLoad[0]);
            // Build the query once with scope and selection, then clone it per cohort so
            // the IN-list size stays within driver limits without rebuilding shared state.
            let baseQuery = preloadQueryForModel(modelsToLoad, targetModelClass);
            baseQuery = this.relationship.applyScope(baseQuery);
            baseQuery = this.selection.applyToQuery({ query: baseQuery, targetModelClass, mappingColumns: [primaryKey] });
            const driver = baseQuery.driver;
            const cohorts = driver.chunkValues([...foreignKeyValues], (chunk) => baseQuery.clone().where({ [primaryKey]: chunk }).toSql());
            for (const cohort of cohorts) {
                const cohortQuery = baseQuery.clone().where({ [primaryKey]: cohort });
                const foundTargetModels = await cohortQuery.toArray();
                targetModels.push(...foundTargetModels);
                for (const targetModel of foundTargetModels) {
                    const primaryKeyValue = /** @type {string | number} */ (targetModel.readColumn(primaryKey));
                    targetModelsById[primaryKeyValue] = targetModel;
                }
            }
        }
        // Set the target preloaded models on the given models
        for (const model of modelsToLoad) {
            const foreignKeyValue = /** @type {string | number} */ (model.readColumn(foreignKey));
            const targetModel = targetModelsById[foreignKeyValue];
            const modelRelationship = model.getRelationshipByName(relationshipName);
            modelRelationship.setPreloaded(true);
            modelRelationship.setLoaded(targetModel);
        }
        return [...satisfiedTargets, ...targetModels];
    }
    /**
     * Preload a polymorphic belongsTo, grouping models by their target type so
     * each concrete target model class is queried separately.
     * @param {object} args - Options object.
     * @param {string} args.foreignKey - Foreign key column.
     * @param {string} args.primaryKey - Primary key column on the target.
     * @param {string} args.relationshipName - Relationship name.
     * @returns {Promise<{targetModels: import("../../record/index.js").default[], targetModelsByClassName: Record<string, import("../../record/index.js").default[]>}>} - Loaded targets and a per-class-name grouping.
     */
    async _runPolymorphic({ foreignKey, primaryKey, relationshipName }) {
        const typeColumn = this.relationship.getPolymorphicTypeColumn();
        const configuration = this.relationship.getConfiguration();
        /**
         * Model meta.
         * @type {{foreignKeyValue: number | string | undefined, model: import("../../record/index.js").default, targetType: string | undefined}[]} */
        const modelMeta = [];
        /**
         * Satisfied targets.
         * @type {import("../../record/index.js").default[]} */
        const satisfiedTargets = [];
        /**
         * Target models by class name.
         * @type {Record<string, import("../../record/index.js").default[]>} */
        const targetModelsByClassName = {};
        for (const model of this.models) {
            const targetType = /** @type {string | undefined} */ (model.readColumn(typeColumn));
            const instanceRelationship = model.getRelationshipByName(relationshipName);
            const targetModelClass = targetType ? bindPreloadModelClass(this.models, configuration.getModelClass(targetType)) : undefined;
            if (targetModelClass && this.selection.isSatisfied({ instanceRelationship, targetModelClass, mappingColumns: [primaryKey] })) {
                const loaded = /** @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined());
                if (loaded) {
                    satisfiedTargets.push(loaded);
                    const className = /** @type {typeof import("../../record/index.js").default} */ (loaded.constructor).getModelName();
                    if (!targetModelsByClassName[className])
                        targetModelsByClassName[className] = [];
                    targetModelsByClassName[className].push(loaded);
                }
                continue;
            }
            modelMeta.push({
                foreignKeyValue: /** @type {string | number | undefined} */ (model.readColumn(foreignKey)),
                model,
                targetType
            });
        }
        /**
         * Foreign key values by type.
         * @type {Record<string, Set<number | string>>} */
        const foreignKeyValuesByType = {};
        for (const meta of modelMeta) {
            if (meta.targetType === undefined || meta.targetType === null)
                continue;
            if (meta.foreignKeyValue === undefined || meta.foreignKeyValue === null)
                continue;
            if (!foreignKeyValuesByType[meta.targetType])
                foreignKeyValuesByType[meta.targetType] = new Set();
            foreignKeyValuesByType[meta.targetType].add(meta.foreignKeyValue);
        }
        /**
         * Target models by type and id.
         * @type {Record<string, Record<number | string, import("../../record/index.js").default>>} */
        const targetModelsByTypeAndId = {};
        /**
         * Target models.
         * @type {import("../../record/index.js").default[]} */
        const targetModels = [];
        for (const targetType in foreignKeyValuesByType) {
            const targetModelClass = bindPreloadModelClass(this.models, configuration.getModelClass(targetType));
            await ensureModelClassInitialized(targetModelClass, configuration, this.models[0]);
            let baseQuery = preloadQueryForModel(this.models, targetModelClass);
            baseQuery = this.relationship.applyScope(baseQuery);
            baseQuery = this.selection.applyToQuery({ query: baseQuery, targetModelClass, mappingColumns: [primaryKey] });
            const driver = baseQuery.driver;
            const cohorts = driver.chunkValues([...foreignKeyValuesByType[targetType]], (chunk) => baseQuery.clone().where({ [primaryKey]: chunk }).toSql());
            targetModelsByTypeAndId[targetType] = {};
            for (const cohort of cohorts) {
                const cohortQuery = baseQuery.clone().where({ [primaryKey]: cohort });
                const foundTargetModels = await cohortQuery.toArray();
                targetModels.push(...foundTargetModels);
                const className = targetModelClass.getModelName();
                if (!targetModelsByClassName[className])
                    targetModelsByClassName[className] = [];
                targetModelsByClassName[className].push(...foundTargetModels);
                for (const targetModel of foundTargetModels) {
                    const primaryKeyValue = /** @type {string | number} */ (targetModel.readColumn(primaryKey));
                    targetModelsByTypeAndId[targetType][primaryKeyValue] = targetModel;
                }
            }
        }
        for (const meta of modelMeta) {
            const modelRelationship = meta.model.getRelationshipByName(relationshipName);
            const targetModel = (meta.targetType && meta.foreignKeyValue !== undefined && meta.foreignKeyValue !== null)
                ? targetModelsByTypeAndId[meta.targetType]?.[meta.foreignKeyValue]
                : undefined;
            modelRelationship.setPreloaded(true);
            modelRelationship.setLoaded(targetModel);
        }
        return { targetModels: [...satisfiedTargets, ...targetModels], targetModelsByClassName };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVsb25ncy10by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9wcmVsb2FkZXIvYmVsb25ncy10by5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTywyQkFBMkIsTUFBTSxxQ0FBcUMsQ0FBQTtBQUM3RSxPQUFPLGtCQUFrQixNQUFNLGdCQUFnQixDQUFBO0FBQy9DLE9BQU8sb0JBQW9CLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxNQUFNLHNCQUFzQixDQUFBO0FBQ2xGLE9BQU8sYUFBYSxNQUFNLG1DQUFtQyxDQUFBO0FBRTdELE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0NBQXdDO0lBQzNEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN4RCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUE7UUFDaEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLElBQUksSUFBSSxrQkFBa0IsRUFBRSxDQUFBO0lBQ3hELENBQUM7SUFFRCxLQUFLLENBQUMsR0FBRztRQUNQLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUN2RCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLDRCQUE0QixDQUFDLEVBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDLENBQUMsQ0FBQTtRQUNySSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ3BELE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FB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QUFDLElBQUksQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLGVBQWUsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLGVBQWUsS0FBSyxJQUFJLENBQUM7Z0JBQzFHLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDO2dCQUNsRSxDQUFDLENBQUMsU0FBUyxDQUFBO1lBRWIsaUJBQWlCLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ3BDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUMxQyxDQUFDO1FBRUQsT0FBTyxFQUFDLFlBQVksRUFBRSxDQUFDLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxZQUFZLENBQUMsRUFBRSx1QkFBdUIsRUFBQyxDQUFBO0lBQ3hGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkIGZyb20gXCIuL2Vuc3VyZS1tb2RlbC1jbGFzcy1pbml0aWFsaXplZC5qc1wiXG5pbXBvcnQgUHJlbG9hZGVyU2VsZWN0aW9uIGZyb20gXCIuL3NlbGVjdGlvbi5qc1wiXG5pbXBvcnQgcHJlbG9hZFF1ZXJ5Rm9yTW9kZWwsIHsgYmluZFByZWxvYWRNb2RlbENsYXNzIH0gZnJvbSBcIi4vcXVlcnktZm9yLW1vZGVsLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5UHJlbG9hZGVyQmVsb25nc1RvIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5tb2RlbHMgLSBNb2RlbCBpbnN0YW5jZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmVsb25ncy10by5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtQcmVsb2FkZXJTZWxlY3Rpb259IFthcmdzLnNlbGVjdGlvbl0gLSBDb2x1bW4gc2VsZWN0aW9uIGFuZCBpZGVtcG90ZW5jeSBydWxlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttb2RlbHMsIHJlbGF0aW9uc2hpcCwgc2VsZWN0aW9uLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5tb2RlbHMgPSBtb2RlbHNcbiAgICB0aGlzLnJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcFxuICAgIHRoaXMuc2VsZWN0aW9uID0gc2VsZWN0aW9uIHx8IG5ldyBQcmVsb2FkZXJTZWxlY3Rpb24oKVxuICB9XG5cbiAgYXN5bmMgcnVuKCkge1xuICAgIGNvbnN0IHNvdXJjZU1vZGVsQ2xhc3MgPSB0aGlzLm1vZGVsc1swXS5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleUZvck1vZGVsQ2xhc3Nlcyh7bW9kZWxDbGFzczogc291cmNlTW9kZWxDbGFzcywgdGFyZ2V0TW9kZWxDbGFzczogc291cmNlTW9kZWxDbGFzc30pXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKClcblxuICAgIGlmICh0aGlzLnJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuUG9seW1vcnBoaWMoe2ZvcmVpZ25LZXksIHByaW1hcnlLZXksIHJlbGF0aW9uc2hpcE5hbWV9KVxuICAgIH1cblxuICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIGJlIGdvdHRlbiBmcm9tIHJlbGF0aW9uc2hpcFwiKVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IGJpbmRQcmVsb2FkTW9kZWxDbGFzcyh0aGlzLm1vZGVscywgcmF3VGFyZ2V0TW9kZWxDbGFzcylcblxuICAgIC8qKlxuICAgICAqIFNhdGlzZmllZCB0YXJnZXRzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IHNhdGlzZmllZFRhcmdldHMgPSBbXVxuICAgIC8qKlxuICAgICAqIE1vZGVscyB0byBsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IG1vZGVsc1RvTG9hZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIHRoaXMubW9kZWxzKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAodGhpcy5zZWxlY3Rpb24uaXNTYXRpc2ZpZWQoe2luc3RhbmNlUmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzLCBtYXBwaW5nQ29sdW1uczogW3ByaW1hcnlLZXldfSkpIHtcbiAgICAgICAgY29uc3QgbG9hZGVkID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi8gKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKCkpXG5cbiAgICAgICAgaWYgKGxvYWRlZCkgc2F0aXNmaWVkVGFyZ2V0cy5wdXNoKGxvYWRlZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1vZGVsc1RvTG9hZC5wdXNoKG1vZGVsKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChtb2RlbHNUb0xvYWQubGVuZ3RoID09IDApIHJldHVybiBzYXRpc2ZpZWRUYXJnZXRzXG5cbiAgICAvKipcbiAgICAgKiBGb3JlaWduIGtleSB2YWx1ZXMuXG4gICAgICogQHR5cGUge1NldDxudW1iZXIgfCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzVG9Mb2FkKSB7XG4gICAgICBjb25zdCBmb3JlaWduS2V5VmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9ICovIChtb2RlbC5yZWFkQ29sdW1uKGZvcmVpZ25LZXkpKVxuXG4gICAgICAvLyBTa2lwIG51bGwvdW5kZWZpbmVkIGZvcmVpZ24ga2V5czogYSBiZWxvbmdzVG8gd2l0aCBubyBmb3JlaWduIGtleSBoYXMgbm9cbiAgICAgIC8vIHRhcmdldCwgYW5kIGluY2x1ZGluZyB0aGVtIHdvdWxkIHNlcmlhbGl6ZSB0byBlLmcuIGBJTiAobnVsbClgIHdoaWNoXG4gICAgICAvLyB0aHJvd3Mgb24gbm9uLXN0cmluZyBwcmltYXJ5LWtleSBjb2x1bW5zLlxuICAgICAgaWYgKGZvcmVpZ25LZXlWYWx1ZSA9PT0gbnVsbCB8fCBmb3JlaWduS2V5VmFsdWUgPT09IHVuZGVmaW5lZCkgY29udGludWVcblxuICAgICAgZm9yZWlnbktleVZhbHVlcy5hZGQoZm9yZWlnbktleVZhbHVlKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRhcmdldCBtb2RlbHMgYnkgaWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCB0YXJnZXRNb2RlbHNCeUlkID0ge31cblxuICAgIC8qKlxuICAgICAqIFRhcmdldCBtb2RlbHMuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgbGV0IHRhcmdldE1vZGVscyA9IFtdXG5cbiAgICAvLyBPbmx5IHF1ZXJ5IHdoZW4gYXQgbGVhc3Qgb25lIG1vZGVsIGhhcyBhIG5vbi1udWxsIGZvcmVpZ24ga2V5LlxuICAgIGlmIChmb3JlaWduS2V5VmFsdWVzLnNpemUgPiAwKSB7XG4gICAgICBhd2FpdCBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQodGFyZ2V0TW9kZWxDbGFzcywgdGhpcy5yZWxhdGlvbnNoaXAuZ2V0Q29uZmlndXJhdGlvbigpLCBtb2RlbHNUb0xvYWRbMF0pXG5cbiAgICAgIC8vIEJ1aWxkIHRoZSBxdWVyeSBvbmNlIHdpdGggc2NvcGUgYW5kIHNlbGVjdGlvbiwgdGhlbiBjbG9uZSBpdCBwZXIgY29ob3J0IHNvXG4gICAgICAvLyB0aGUgSU4tbGlzdCBzaXplIHN0YXlzIHdpdGhpbiBkcml2ZXIgbGltaXRzIHdpdGhvdXQgcmVidWlsZGluZyBzaGFyZWQgc3RhdGUuXG4gICAgICBsZXQgYmFzZVF1ZXJ5ID0gcHJlbG9hZFF1ZXJ5Rm9yTW9kZWwobW9kZWxzVG9Mb2FkLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBiYXNlUXVlcnkgPSB0aGlzLnJlbGF0aW9uc2hpcC5hcHBseVNjb3BlKGJhc2VRdWVyeSlcbiAgICAgIGJhc2VRdWVyeSA9IHRoaXMuc2VsZWN0aW9uLmFwcGx5VG9RdWVyeSh7cXVlcnk6IGJhc2VRdWVyeSwgdGFyZ2V0TW9kZWxDbGFzcywgbWFwcGluZ0NvbHVtbnM6IFtwcmltYXJ5S2V5XX0pXG5cbiAgICAgIGNvbnN0IGRyaXZlciA9IGJhc2VRdWVyeS5kcml2ZXJcbiAgICAgIGNvbnN0IGNvaG9ydHMgPSBkcml2ZXIuY2h1bmtWYWx1ZXMoWy4uLmZvcmVpZ25LZXlWYWx1ZXNdLCAoY2h1bmspID0+IGJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbcHJpbWFyeUtleV06IGNodW5rfSkudG9TcWwoKSlcblxuICAgICAgZm9yIChjb25zdCBjb2hvcnQgb2YgY29ob3J0cykge1xuICAgICAgICBjb25zdCBjb2hvcnRRdWVyeSA9IGJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbcHJpbWFyeUtleV06IGNvaG9ydH0pXG4gICAgICAgIGNvbnN0IGZvdW5kVGFyZ2V0TW9kZWxzID0gYXdhaXQgY29ob3J0UXVlcnkudG9BcnJheSgpXG5cbiAgICAgICAgdGFyZ2V0TW9kZWxzLnB1c2goLi4uZm91bmRUYXJnZXRNb2RlbHMpXG5cbiAgICAgICAgZm9yIChjb25zdCB0YXJnZXRNb2RlbCBvZiBmb3VuZFRhcmdldE1vZGVscykge1xuICAgICAgICAgIGNvbnN0IHByaW1hcnlLZXlWYWx1ZSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGFyZ2V0TW9kZWwucmVhZENvbHVtbihwcmltYXJ5S2V5KSlcblxuICAgICAgICAgIHRhcmdldE1vZGVsc0J5SWRbcHJpbWFyeUtleVZhbHVlXSA9IHRhcmdldE1vZGVsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXQgdGhlIHRhcmdldCBwcmVsb2FkZWQgbW9kZWxzIG9uIHRoZSBnaXZlbiBtb2RlbHNcbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc1RvTG9hZCkge1xuICAgICAgY29uc3QgZm9yZWlnbktleVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQ29sdW1uKGZvcmVpZ25LZXkpKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWwgPSB0YXJnZXRNb2RlbHNCeUlkW2ZvcmVpZ25LZXlWYWx1ZV1cbiAgICAgIGNvbnN0IG1vZGVsUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIG1vZGVsUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHRhcmdldE1vZGVsKVxuICAgIH1cblxuICAgIHJldHVybiBbLi4uc2F0aXNmaWVkVGFyZ2V0cywgLi4udGFyZ2V0TW9kZWxzXVxuICB9XG5cbiAgLyoqXG4gICAqIFByZWxvYWQgYSBwb2x5bW9ycGhpYyBiZWxvbmdzVG8sIGdyb3VwaW5nIG1vZGVscyBieSB0aGVpciB0YXJnZXQgdHlwZSBzb1xuICAgKiBlYWNoIGNvbmNyZXRlIHRhcmdldCBtb2RlbCBjbGFzcyBpcyBxdWVyaWVkIHNlcGFyYXRlbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZvcmVpZ25LZXkgLSBGb3JlaWduIGtleSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByaW1hcnlLZXkgLSBQcmltYXJ5IGtleSBjb2x1bW4gb24gdGhlIHRhcmdldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7dGFyZ2V0TW9kZWxzOiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdLCB0YXJnZXRNb2RlbHNCeUNsYXNzTmFtZTogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59Pn0gLSBMb2FkZWQgdGFyZ2V0cyBhbmQgYSBwZXItY2xhc3MtbmFtZSBncm91cGluZy5cbiAgICovXG4gIGFzeW5jIF9ydW5Qb2x5bW9ycGhpYyh7Zm9yZWlnbktleSwgcHJpbWFyeUtleSwgcmVsYXRpb25zaGlwTmFtZX0pIHtcbiAgICBjb25zdCB0eXBlQ29sdW1uID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWNUeXBlQ29sdW1uKClcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbCBtZXRhLlxuICAgICAqIEB0eXBlIHt7Zm9yZWlnbktleVZhbHVlOiBudW1iZXIgfCBzdHJpbmcgfCB1bmRlZmluZWQsIG1vZGVsOiBpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgdGFyZ2V0VHlwZTogc3RyaW5nIHwgdW5kZWZpbmVkfVtdfSAqL1xuICAgIGNvbnN0IG1vZGVsTWV0YSA9IFtdXG5cbiAgICAvKipcbiAgICAgKiBTYXRpc2ZpZWQgdGFyZ2V0cy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBzYXRpc2ZpZWRUYXJnZXRzID0gW11cblxuICAgIC8qKlxuICAgICAqIFRhcmdldCBtb2RlbHMgYnkgY2xhc3MgbmFtZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59ICovXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWUgPSB7fVxuXG4gICAgZm9yIChjb25zdCBtb2RlbCBvZiB0aGlzLm1vZGVscykge1xuICAgICAgY29uc3QgdGFyZ2V0VHlwZSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqLyAobW9kZWwucmVhZENvbHVtbih0eXBlQ29sdW1uKSlcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0VHlwZSA/IGJpbmRQcmVsb2FkTW9kZWxDbGFzcyh0aGlzLm1vZGVscywgY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzKHRhcmdldFR5cGUpKSA6IHVuZGVmaW5lZFxuXG4gICAgICBpZiAodGFyZ2V0TW9kZWxDbGFzcyAmJiB0aGlzLnNlbGVjdGlvbi5pc1NhdGlzZmllZCh7aW5zdGFuY2VSZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zOiBbcHJpbWFyeUtleV19KSkge1xuICAgICAgICBjb25zdCBsb2FkZWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqLyAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSlcblxuICAgICAgICBpZiAobG9hZGVkKSB7XG4gICAgICAgICAgc2F0aXNmaWVkVGFyZ2V0cy5wdXNoKGxvYWRlZClcblxuICAgICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobG9hZGVkLmNvbnN0cnVjdG9yKS5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICAgICAgaWYgKCF0YXJnZXRNb2RlbHNCeUNsYXNzTmFtZVtjbGFzc05hbWVdKSB0YXJnZXRNb2RlbHNCeUNsYXNzTmFtZVtjbGFzc05hbWVdID0gW11cbiAgICAgICAgICB0YXJnZXRNb2RlbHNCeUNsYXNzTmFtZVtjbGFzc05hbWVdLnB1c2gobG9hZGVkKVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbW9kZWxNZXRhLnB1c2goe1xuICAgICAgICBmb3JlaWduS2V5VmFsdWU6IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyIHwgdW5kZWZpbmVkfSAqLyAobW9kZWwucmVhZENvbHVtbihmb3JlaWduS2V5KSksXG4gICAgICAgIG1vZGVsLFxuICAgICAgICB0YXJnZXRUeXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZvcmVpZ24ga2V5IHZhbHVlcyBieSB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBTZXQ8bnVtYmVyIHwgc3RyaW5nPj59ICovXG4gICAgY29uc3QgZm9yZWlnbktleVZhbHVlc0J5VHlwZSA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IG1ldGEgb2YgbW9kZWxNZXRhKSB7XG4gICAgICBpZiAobWV0YS50YXJnZXRUeXBlID09PSB1bmRlZmluZWQgfHwgbWV0YS50YXJnZXRUeXBlID09PSBudWxsKSBjb250aW51ZVxuICAgICAgaWYgKG1ldGEuZm9yZWlnbktleVZhbHVlID09PSB1bmRlZmluZWQgfHwgbWV0YS5mb3JlaWduS2V5VmFsdWUgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGlmICghZm9yZWlnbktleVZhbHVlc0J5VHlwZVttZXRhLnRhcmdldFR5cGVdKSBmb3JlaWduS2V5VmFsdWVzQnlUeXBlW21ldGEudGFyZ2V0VHlwZV0gPSBuZXcgU2V0KClcbiAgICAgIGZvcmVpZ25LZXlWYWx1ZXNCeVR5cGVbbWV0YS50YXJnZXRUeXBlXS5hZGQobWV0YS5mb3JlaWduS2V5VmFsdWUpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGFyZ2V0IG1vZGVscyBieSB0eXBlIGFuZCBpZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPG51bWJlciB8IHN0cmluZywgaW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCB0YXJnZXRNb2RlbHNCeVR5cGVBbmRJZCA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBUYXJnZXQgbW9kZWxzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IHRhcmdldE1vZGVscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHRhcmdldFR5cGUgaW4gZm9yZWlnbktleVZhbHVlc0J5VHlwZSkge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IGJpbmRQcmVsb2FkTW9kZWxDbGFzcyh0aGlzLm1vZGVscywgY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzKHRhcmdldFR5cGUpKVxuXG4gICAgICBhd2FpdCBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQodGFyZ2V0TW9kZWxDbGFzcywgY29uZmlndXJhdGlvbiwgdGhpcy5tb2RlbHNbMF0pXG5cbiAgICAgIGxldCBiYXNlUXVlcnkgPSBwcmVsb2FkUXVlcnlGb3JNb2RlbCh0aGlzLm1vZGVscywgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgYmFzZVF1ZXJ5ID0gdGhpcy5yZWxhdGlvbnNoaXAuYXBwbHlTY29wZShiYXNlUXVlcnkpXG4gICAgICBiYXNlUXVlcnkgPSB0aGlzLnNlbGVjdGlvbi5hcHBseVRvUXVlcnkoe3F1ZXJ5OiBiYXNlUXVlcnksIHRhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zOiBbcHJpbWFyeUtleV19KVxuXG4gICAgICBjb25zdCBkcml2ZXIgPSBiYXNlUXVlcnkuZHJpdmVyXG4gICAgICBjb25zdCBjb2hvcnRzID0gZHJpdmVyLmNodW5rVmFsdWVzKFsuLi5mb3JlaWduS2V5VmFsdWVzQnlUeXBlW3RhcmdldFR5cGVdXSwgKGNodW5rKSA9PiBiYXNlUXVlcnkuY2xvbmUoKS53aGVyZSh7W3ByaW1hcnlLZXldOiBjaHVua30pLnRvU3FsKCkpXG5cbiAgICAgIHRhcmdldE1vZGVsc0J5VHlwZUFuZElkW3RhcmdldFR5cGVdID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2hvcnQgb2YgY29ob3J0cykge1xuICAgICAgICBjb25zdCBjb2hvcnRRdWVyeSA9IGJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbcHJpbWFyeUtleV06IGNvaG9ydH0pXG4gICAgICAgIGNvbnN0IGZvdW5kVGFyZ2V0TW9kZWxzID0gYXdhaXQgY29ob3J0UXVlcnkudG9BcnJheSgpXG5cbiAgICAgICAgdGFyZ2V0TW9kZWxzLnB1c2goLi4uZm91bmRUYXJnZXRNb2RlbHMpXG5cbiAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICAgIGlmICghdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWVbY2xhc3NOYW1lXSkgdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWVbY2xhc3NOYW1lXSA9IFtdXG4gICAgICAgIHRhcmdldE1vZGVsc0J5Q2xhc3NOYW1lW2NsYXNzTmFtZV0ucHVzaCguLi5mb3VuZFRhcmdldE1vZGVscylcblxuICAgICAgICBmb3IgKGNvbnN0IHRhcmdldE1vZGVsIG9mIGZvdW5kVGFyZ2V0TW9kZWxzKSB7XG4gICAgICAgICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovICh0YXJnZXRNb2RlbC5yZWFkQ29sdW1uKHByaW1hcnlLZXkpKVxuXG4gICAgICAgICAgdGFyZ2V0TW9kZWxzQnlUeXBlQW5kSWRbdGFyZ2V0VHlwZV1bcHJpbWFyeUtleVZhbHVlXSA9IHRhcmdldE1vZGVsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1ldGEgb2YgbW9kZWxNZXRhKSB7XG4gICAgICBjb25zdCBtb2RlbFJlbGF0aW9uc2hpcCA9IG1ldGEubW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbCA9IChtZXRhLnRhcmdldFR5cGUgJiYgbWV0YS5mb3JlaWduS2V5VmFsdWUgIT09IHVuZGVmaW5lZCAmJiBtZXRhLmZvcmVpZ25LZXlWYWx1ZSAhPT0gbnVsbClcbiAgICAgICAgPyB0YXJnZXRNb2RlbHNCeVR5cGVBbmRJZFttZXRhLnRhcmdldFR5cGVdPy5bbWV0YS5mb3JlaWduS2V5VmFsdWVdXG4gICAgICAgIDogdW5kZWZpbmVkXG5cbiAgICAgIG1vZGVsUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHRhcmdldE1vZGVsKVxuICAgIH1cblxuICAgIHJldHVybiB7dGFyZ2V0TW9kZWxzOiBbLi4uc2F0aXNmaWVkVGFyZ2V0cywgLi4udGFyZ2V0TW9kZWxzXSwgdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWV9XG4gIH1cbn1cbiJdfQ==