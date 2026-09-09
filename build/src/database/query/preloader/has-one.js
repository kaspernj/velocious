// @ts-check
import ensureModelClassInitialized from "./ensure-model-class-initialized.js";
import PreloaderSelection from "./selection.js";
import preloadQueryForModel, { bindPreloadModelClass } from "./query-for-model.js";
import restArgsError from "../../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryPreloaderHasOne {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Array<import("../../record/index.js").default>} args.models - Model instances.
     * @param {import("../../record/relationships/has-one.js").default} args.relationship - Relationship.
     * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
     */
    constructor({ models, relationship, selection, ...restArgs }) {
        restArgsError(restArgs);
        this.models = models;
        this.relationship = relationship;
        this.selection = selection || new PreloaderSelection();
    }
    async run() {
        /**
         * Models primary key values.
         * @type {Set<number | string>} */
        const modelsPrimaryKeyValues = new Set();
        /**
         * Models by primary key value.
         * @type {Record<number | string, Array<import("../../record/index.js").default>>} */
        const modelsByPrimaryKeyValue = {};
        const primaryKey = this.relationship.getPrimaryKey();
        const relationshipName = this.relationship.getRelationshipName();
        const rawTargetModelClass = this.relationship.getTargetModelClass();
        if (!rawTargetModelClass)
            throw new Error("No target model class could be gotten from relationship");
        const sourceModelClass = this.models[0].getModelClass();
        const targetModelClass = bindPreloadModelClass(this.models, rawTargetModelClass);
        const foreignKey = this.relationship.getForeignKeyForModelClasses({ modelClass: sourceModelClass, targetModelClass });
        /**
         * Preload collections.
         * @type {Record<number | string, import("../../record/index.js").default | undefined>} */
        const preloadCollections = {};
        /**
         * Satisfied targets.
         * @type {import("../../record/index.js").default[]} */
        const satisfiedTargets = [];
        for (const model of this.models) {
            const instanceRelationship = model.getRelationshipByName(relationshipName);
            if (this.selection.isSatisfied({ instanceRelationship, targetModelClass, mappingColumns: [foreignKey] })) {
                const loaded = /** @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined());
                if (loaded)
                    satisfiedTargets.push(loaded);
                continue;
            }
            const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey));
            preloadCollections[primaryKeyValue] = undefined;
            modelsPrimaryKeyValues.add(primaryKeyValue);
            if (!(primaryKeyValue in modelsByPrimaryKeyValue))
                modelsByPrimaryKeyValue[primaryKeyValue] = [];
            modelsByPrimaryKeyValue[primaryKeyValue].push(model);
        }
        if (modelsPrimaryKeyValues.size == 0)
            return satisfiedTargets;
        await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration(), this.models[0]);
        // Load target models to be preloaded on the given models.
        // Build the query once with the polymorphic type constant (when present),
        // relationship scope, and selection. The parent ID IN-list is cloned per cohort
        // so the generated SQL stays within driver limits.
        let baseQuery = preloadQueryForModel(this.models, targetModelClass);
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
            preloadCollections[foreignKeyValue] = targetModel;
        }
        // Set the target preloaded models on the given models
        for (const modelValue in preloadCollections) {
            const preloadedModel = preloadCollections[modelValue];
            for (const model of modelsByPrimaryKeyValue[modelValue]) {
                const modelRelationship = model.getRelationshipByName(relationshipName);
                modelRelationship.setPreloaded(true);
                modelRelationship.setLoaded(preloadedModel);
            }
        }
        return [...satisfiedTargets, ...targetModels];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFzLW9uZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9wcmVsb2FkZXIvaGFzLW9uZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTywyQkFBMkIsTUFBTSxxQ0FBcUMsQ0FBQTtBQUM3RSxPQUFPLGtCQUFrQixNQUFNLGdCQUFnQixDQUFBO0FBQy9DLE9BQU8sb0JBQW9CLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxNQUFNLHNCQUFzQixDQUFBO0FBQ2xGLE9BQU8sYUFBYSxNQUFNLG1DQUFtQyxDQUFBO0FBRTdELE1BQU0sQ0FBQyxPQUFPLE9BQU8scUNBQXFDO0lBQ3hEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUN4RCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUE7UUFDaEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLElBQUksSUFBSSxrQkFBa0IsRUFBRSxDQUFBO0lBQ3hELENBQUM7SUFFRCxLQUFLLENBQUMsR0FBRztRQUNQOzswQ0FFa0M7UUFDbEMsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXhDOzs2RkFFcUY7UUFDckYsTUFBTSx1QkFBdUIsR0FBRyxFQUFFLENBQUE7UUFFbEMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUNwRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUVoRSxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUVuRSxJQUFJ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QUFHLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO2dCQUV2RSxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQ3BDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUM3QyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLGdCQUFnQixFQUFFLEdBQUcsWUFBWSxDQUFDLENBQUE7SUFDL0MsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQgZnJvbSBcIi4vZW5zdXJlLW1vZGVsLWNsYXNzLWluaXRpYWxpemVkLmpzXCJcbmltcG9ydCBQcmVsb2FkZXJTZWxlY3Rpb24gZnJvbSBcIi4vc2VsZWN0aW9uLmpzXCJcbmltcG9ydCBwcmVsb2FkUXVlcnlGb3JNb2RlbCwgeyBiaW5kUHJlbG9hZE1vZGVsQ2xhc3MgfSBmcm9tIFwiLi9xdWVyeS1mb3ItbW9kZWwuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQcmVsb2FkZXJIYXNPbmUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi8uLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MubW9kZWxzIC0gTW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3JlY29yZC9yZWxhdGlvbnNoaXBzL2hhcy1vbmUuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UHJlbG9hZGVyU2VsZWN0aW9ufSBbYXJncy5zZWxlY3Rpb25dIC0gQ29sdW1uIHNlbGVjdGlvbiBhbmQgaWRlbXBvdGVuY3kgcnVsZXMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7bW9kZWxzLCByZWxhdGlvbnNoaXAsIHNlbGVjdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIHRoaXMubW9kZWxzID0gbW9kZWxzXG4gICAgdGhpcy5yZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXBcbiAgICB0aGlzLnNlbGVjdGlvbiA9IHNlbGVjdGlvbiB8fCBuZXcgUHJlbG9hZGVyU2VsZWN0aW9uKClcbiAgfVxuXG4gIGFzeW5jIHJ1bigpIHtcbiAgICAvKipcbiAgICAgKiBNb2RlbHMgcHJpbWFyeSBrZXkgdmFsdWVzLlxuICAgICAqIEB0eXBlIHtTZXQ8bnVtYmVyIHwgc3RyaW5nPn0gKi9cbiAgICBjb25zdCBtb2RlbHNQcmltYXJ5S2V5VmFsdWVzID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbHMgYnkgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAgICogQHR5cGUge1JlY29yZDxudW1iZXIgfCBzdHJpbmcsIEFycmF5PGltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pj59ICovXG4gICAgY29uc3QgbW9kZWxzQnlQcmltYXJ5S2V5VmFsdWUgPSB7fVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKClcblxuICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIGJlIGdvdHRlbiBmcm9tIHJlbGF0aW9uc2hpcFwiKVxuXG4gICAgY29uc3Qgc291cmNlTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxzWzBdLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBiaW5kUHJlbG9hZE1vZGVsQ2xhc3ModGhpcy5tb2RlbHMsIHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMucmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe21vZGVsQ2xhc3M6IHNvdXJjZU1vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgLyoqXG4gICAgICogUHJlbG9hZCBjb2xsZWN0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPG51bWJlciB8IHN0cmluZywgaW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAqL1xuICAgIGNvbnN0IHByZWxvYWRDb2xsZWN0aW9ucyA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBTYXRpc2ZpZWQgdGFyZ2V0cy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBzYXRpc2ZpZWRUYXJnZXRzID0gW11cblxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgdGhpcy5tb2RlbHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmICh0aGlzLnNlbGVjdGlvbi5pc1NhdGlzZmllZCh7aW5zdGFuY2VSZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MsIG1hcHBpbmdDb2x1bW5zOiBbZm9yZWlnbktleV19KSkge1xuICAgICAgICBjb25zdCBsb2FkZWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqLyAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSlcblxuICAgICAgICBpZiAobG9hZGVkKSBzYXRpc2ZpZWRUYXJnZXRzLnB1c2gobG9hZGVkKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpXG5cbiAgICAgIHByZWxvYWRDb2xsZWN0aW9uc1twcmltYXJ5S2V5VmFsdWVdID0gdW5kZWZpbmVkXG5cbiAgICAgIG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMuYWRkKHByaW1hcnlLZXlWYWx1ZSlcbiAgICAgIGlmICghKHByaW1hcnlLZXlWYWx1ZSBpbiBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZSkpIG1vZGVsc0J5UHJpbWFyeUtleVZhbHVlW3ByaW1hcnlLZXlWYWx1ZV0gPSBbXVxuXG4gICAgICBtb2RlbHNCeVByaW1hcnlLZXlWYWx1ZVtwcmltYXJ5S2V5VmFsdWVdLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgaWYgKG1vZGVsc1ByaW1hcnlLZXlWYWx1ZXMuc2l6ZSA9PSAwKSByZXR1cm4gc2F0aXNmaWVkVGFyZ2V0c1xuXG4gICAgYXdhaXQgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKHRhcmdldE1vZGVsQ2xhc3MsIHRoaXMucmVsYXRpb25zaGlwLmdldENvbmZpZ3VyYXRpb24oKSwgdGhpcy5tb2RlbHNbMF0pXG5cbiAgICAvLyBMb2FkIHRhcmdldCBtb2RlbHMgdG8gYmUgcHJlbG9hZGVkIG9uIHRoZSBnaXZlbiBtb2RlbHMuXG4gICAgLy8gQnVpbGQgdGhlIHF1ZXJ5IG9uY2Ugd2l0aCB0aGUgcG9seW1vcnBoaWMgdHlwZSBjb25zdGFudCAod2hlbiBwcmVzZW50KSxcbiAgICAvLyByZWxhdGlvbnNoaXAgc2NvcGUsIGFuZCBzZWxlY3Rpb24uIFRoZSBwYXJlbnQgSUQgSU4tbGlzdCBpcyBjbG9uZWQgcGVyIGNvaG9ydFxuICAgIC8vIHNvIHRoZSBnZW5lcmF0ZWQgU1FMIHN0YXlzIHdpdGhpbiBkcml2ZXIgbGltaXRzLlxuICAgIGxldCBiYXNlUXVlcnkgPSBwcmVsb2FkUXVlcnlGb3JNb2RlbCh0aGlzLm1vZGVscywgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgIGlmICh0aGlzLnJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICBjb25zdCB0eXBlQ29sdW1uID0gdGhpcy5yZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWNUeXBlQ29sdW1uKClcblxuICAgICAgYmFzZVF1ZXJ5ID0gYmFzZVF1ZXJ5LndoZXJlKHtbdHlwZUNvbHVtbl06IHRoaXMucmVsYXRpb25zaGlwLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKX0pXG4gICAgfVxuXG4gICAgYmFzZVF1ZXJ5ID0gdGhpcy5yZWxhdGlvbnNoaXAuYXBwbHlTY29wZShiYXNlUXVlcnkpXG4gICAgYmFzZVF1ZXJ5ID0gdGhpcy5zZWxlY3Rpb24uYXBwbHlUb1F1ZXJ5KHtxdWVyeTogYmFzZVF1ZXJ5LCB0YXJnZXRNb2RlbENsYXNzLCBtYXBwaW5nQ29sdW1uczogW2ZvcmVpZ25LZXldfSlcblxuICAgIC8qKlxuICAgICAqIFRhcmdldCBtb2RlbHMuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxzID0gW11cbiAgICBjb25zdCBkcml2ZXIgPSBiYXNlUXVlcnkuZHJpdmVyXG4gICAgY29uc3QgY29ob3J0cyA9IGRyaXZlci5jaHVua1ZhbHVlcyhbLi4ubW9kZWxzUHJpbWFyeUtleVZhbHVlc10sIChjaHVuaykgPT4gYmFzZVF1ZXJ5LmNsb25lKCkud2hlcmUoe1tmb3JlaWduS2V5XTogY2h1bmt9KS50b1NxbCgpKVxuXG4gICAgZm9yIChjb25zdCBjb2hvcnQgb2YgY29ob3J0cykge1xuICAgICAgY29uc3QgY29ob3J0UXVlcnkgPSBiYXNlUXVlcnkuY2xvbmUoKS53aGVyZSh7W2ZvcmVpZ25LZXldOiBjb2hvcnR9KVxuICAgICAgY29uc3QgZm91bmRUYXJnZXRNb2RlbHMgPSBhd2FpdCBjb2hvcnRRdWVyeS50b0FycmF5KClcblxuICAgICAgdGFyZ2V0TW9kZWxzLnB1c2goLi4uZm91bmRUYXJnZXRNb2RlbHMpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0YXJnZXRNb2RlbCBvZiB0YXJnZXRNb2RlbHMpIHtcbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGFyZ2V0TW9kZWwucmVhZENvbHVtbihmb3JlaWduS2V5KSlcblxuICAgICAgcHJlbG9hZENvbGxlY3Rpb25zW2ZvcmVpZ25LZXlWYWx1ZV0gPSB0YXJnZXRNb2RlbFxuICAgIH1cblxuICAgIC8vIFNldCB0aGUgdGFyZ2V0IHByZWxvYWRlZCBtb2RlbHMgb24gdGhlIGdpdmVuIG1vZGVsc1xuICAgIGZvciAoY29uc3QgbW9kZWxWYWx1ZSBpbiBwcmVsb2FkQ29sbGVjdGlvbnMpIHtcbiAgICAgIGNvbnN0IHByZWxvYWRlZE1vZGVsID0gcHJlbG9hZENvbGxlY3Rpb25zW21vZGVsVmFsdWVdXG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzQnlQcmltYXJ5S2V5VmFsdWVbbW9kZWxWYWx1ZV0pIHtcbiAgICAgICAgY29uc3QgbW9kZWxSZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgICBtb2RlbFJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgICAgbW9kZWxSZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHByZWxvYWRlZE1vZGVsKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBbLi4uc2F0aXNmaWVkVGFyZ2V0cywgLi4udGFyZ2V0TW9kZWxzXVxuICB9XG59XG4iXX0=