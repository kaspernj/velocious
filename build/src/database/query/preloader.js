// @ts-check
import BelongsToPreloader from "./preloader/belongs-to.js";
import HasManyPreloader from "./preloader/has-many.js";
import HasOnePreloader from "./preloader/has-one.js";
import PreloaderSelection from "./preloader/selection.js";
import restArgsError from "../../utils/rest-args-error.js";
/**
 * Runs normalize nested preload.
 * @param {import("../query/index.js").NestedPreloadRecord | string | string[] | boolean} preload - Preload data in shorthand or nested form.
 * @returns {import("../query/index.js").NestedPreloadRecord | null} - Normalized nested preload record.
 */
function normalizeNestedPreload(preload) {
    if (!preload || typeof preload == "boolean")
        return null;
    if (typeof preload == "string") {
        return { [preload]: true };
    }
    if (Array.isArray(preload)) {
        /**
         * Result.
         * @type {import("../query/index.js").NestedPreloadRecord} */
        const result = {};
        for (const entry of preload) {
            if (typeof entry == "string") {
                result[entry] = true;
                continue;
            }
            if (entry && typeof entry == "object") {
                const normalizedEntry = normalizeNestedPreload(entry);
                if (normalizedEntry) {
                    for (const [key, value] of Object.entries(normalizedEntry)) {
                        result[key] = value;
                    }
                }
                continue;
            }
            throw new Error(`Invalid preload entry type: ${typeof entry}`);
        }
        return result;
    }
    if (preload && typeof preload == "object") {
        /**
         * Result.
         * @type {import("../query/index.js").NestedPreloadRecord} */
        const result = {};
        for (const [key, value] of Object.entries(preload)) {
            if (value === true || value === false) {
                result[key] = value;
                continue;
            }
            const normalizedValue = normalizeNestedPreload(value);
            if (normalizedValue) {
                result[key] = normalizedValue;
            }
            else {
                throw new Error(`Invalid preload value for ${key}: ${typeof value}`);
            }
        }
        return result;
    }
    throw new Error(`Invalid preload type: ${typeof preload}`);
}
export default class VelociousDatabaseQueryPreloader {
    /**
     * Preloads relationship(s) onto one or more already-loaded model instances.
     * Accepts either a query built via `Model.preload(...).select(...)` (its
     * preload graph and selects are used) or a raw preload spec
     * (string / array / nested object).
     * @param {Array<import("../record/index.js").default>} models - Model instances to preload onto.
     * @param {import("./model-class-query.js").default | import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
     * @param {{force?: boolean}} [options] - Options.
     * @returns {Promise<void>} - Resolves when preloading completes.
     */
    static async preload(models, queryOrSpec, { force = false } = {}) {
        if (models.length == 0)
            return;
        const modelClass = models[0].getModelClass();
        const isQuery = Boolean(queryOrSpec) && typeof queryOrSpec == "object" && "_preload" in queryOrSpec;
        // Reuse the query builder's preload/select normalization for raw specs
        // instead of duplicating it here.
        const query = isQuery
            ? /** @type {import("./model-class-query.js").default} */ (queryOrSpec)
            : modelClass.preload(/** @type {ReturnType<typeof JSON.parse>} */ (queryOrSpec));
        const preloader = new VelociousDatabaseQueryPreloader({
            modelClass,
            models,
            preload: query._preload,
            selection: new PreloaderSelection({
                preloadSelects: query._preloadSelects,
                preloadSelectsExtra: query._preloadSelectsExtra,
                force
            })
        });
        await preloader.run();
    }
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {import("../record/index.js").default[]} args.models - Model instances.
     * @param {import("../query/index.js").NestedPreloadRecord} args.preload - Preload.
     * @param {Record<string, string[]>} [args.preloadSelects] - Narrowing selects keyed by target model name.
     * @param {Record<string, string[]>} [args.preloadSelectsExtra] - Extra selects keyed by target model name.
     * @param {PreloaderSelection} [args.selection] - Pre-built selection (takes precedence over the select maps when given).
     */
    constructor({ modelClass, models, preload, preloadSelects = {}, preloadSelectsExtra = {}, selection, ...restArgs }) {
        restArgsError(restArgs);
        this.modelClass = modelClass;
        this.models = models;
        this.preload = preload;
        this.selection = selection || new PreloaderSelection({ preloadSelects, preloadSelectsExtra });
    }
    async run() {
        for (const preloadRelationshipName in this.preload) {
            const modelClassRelationship = this.modelClass.getRelationshipByName(preloadRelationshipName);
            const relationship = this.models.length > 0 ? modelClassRelationship.resolveForRecord(this.models[0]) : modelClassRelationship;
            for (const model of this.models) {
                if (modelClassRelationship.resolveForRecord(model) !== relationship) {
                    throw new Error(`Cannot preload ${this.modelClass.name}#${preloadRelationshipName} across physical database identities`);
                }
            }
            let preloadResult;
            if (relationship.getType() == "belongsTo") {
                const belongsToRelationship = /** @type {import("../record/relationships/belongs-to.js").default} */ (relationship);
                const hasManyPreloader = new BelongsToPreloader({ models: this.models, relationship: belongsToRelationship, selection: this.selection });
                preloadResult = await hasManyPreloader.run();
            }
            else if (relationship.getType() == "hasMany") {
                const hasManyRelationship = /** @type {import("../record/relationships/has-many.js").default} */ (relationship);
                const hasManyPreloader = new HasManyPreloader({ models: this.models, relationship: hasManyRelationship, selection: this.selection });
                preloadResult = await hasManyPreloader.run();
            }
            else if (relationship.getType() == "hasOne") {
                const hasOneRelationship = /** @type {import("../record/relationships/has-one.js").default} */ (relationship);
                const hasOnePreloader = new HasOnePreloader({ models: this.models, relationship: hasOneRelationship, selection: this.selection });
                preloadResult = await hasOnePreloader.run();
            }
            else {
                throw new Error(`Unknown relationship type: ${relationship.getType()}`);
            }
            const targetModels = Array.isArray(preloadResult) ? preloadResult : (preloadResult?.targetModels || []);
            const targetModelsByClassName = Array.isArray(preloadResult) ? undefined : preloadResult?.targetModelsByClassName;
            // Handle any further preloads in the tree
            const newPreload = this.preload[preloadRelationshipName];
            const normalizedPreload = normalizeNestedPreload(newPreload);
            if (normalizedPreload && targetModels.length > 0) {
                if (relationship.getPolymorphic() && targetModelsByClassName) {
                    const configuration = relationship.getConfiguration();
                    for (const className in targetModelsByClassName) {
                        const models = targetModelsByClassName[className];
                        if (models.length == 0)
                            continue;
                        const targetModelClass = this.modelClass.bindRecordMetadataModelClass(configuration.getModelClass(className));
                        const preloader = new VelociousDatabaseQueryPreloader({ modelClass: targetModelClass, models, preload: normalizedPreload, selection: this.selection });
                        await preloader.run();
                    }
                }
                else {
                    const rawTargetModelClass = relationship.getTargetModelClass();
                    if (!rawTargetModelClass)
                        throw new Error("No target model class could be gotten from relationship");
                    const targetModelClass = this.modelClass.bindRecordMetadataModelClass(rawTargetModelClass);
                    const preloader = new VelociousDatabaseQueryPreloader({ modelClass: targetModelClass, models: targetModels, preload: normalizedPreload, selection: this.selection });
                    await preloader.run();
                }
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlbG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L3ByZWxvYWRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLGdCQUFnQixNQUFNLHlCQUF5QixDQUFBO0FBQ3RELE9BQU8sZUFBZSxNQUFNLHdCQUF3QixDQUFBO0FBQ3BELE9BQU8sa0JBQWtCLE1BQU0sMEJBQTBCLENBQUE7QUFDekQsT0FBTyxhQUFhLE1BQU0sZ0NBQWdDLENBQUE7QUFFMUQ7Ozs7R0FJRztBQUNILFNBQVMsc0JBQXNCLENBQUMsT0FBTztJQUNyQyxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sT0FBTyxJQUFJLFNBQVM7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUV4RCxJQUFJLE9BQU8sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQy9CLE9BQU8sRUFBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQzFCLENBQUM7SUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUMzQjs7cUVBRTZEO1FBQzdELE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixLQUFLLE1BQU0sS0FBSyxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzVCLElBQUksT0FBTyxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQzdCLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUE7Z0JBQ3BCLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQ3RDLE1BQU0sZUFBZSxHQUFHLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFBO2dCQUVyRCxJQUFJLGVBQWUsRUFBRSxDQUFDO29CQUNwQixLQUFL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LEVBQUUsQ0FBQTtvQkFDdkIsQ0FBQztnQkFDSCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxtQkFBbUIsR0FBRyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtvQkFFOUQsSUFBSSxDQUFDLG1CQUFtQjt3QkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUE7b0JBRXBHLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyw0QkFBNEIsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO29CQUUxRixNQUFNLFNBQVMsR0FBRyxJQUFJLCtCQUErQixDQUFDLEVBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGlCQUFpQixFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFDLENBQUMsQ0FBQTtvQkFFbEssTUFBTSxTQUFTLENBQUMsR0FBRyxFQUFFLENBQUE7Z0JBQ3ZCLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmVsb25nc1RvUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBIYXNNYW55UHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci9oYXMtbWFueS5qc1wiXG5pbXBvcnQgSGFzT25lUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci9oYXMtb25lLmpzXCJcbmltcG9ydCBQcmVsb2FkZXJTZWxlY3Rpb24gZnJvbSBcIi4vcHJlbG9hZGVyL3NlbGVjdGlvbi5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBuZXN0ZWQgcHJlbG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IHN0cmluZ1tdIHwgYm9vbGVhbn0gcHJlbG9hZCAtIFByZWxvYWQgZGF0YSBpbiBzaG9ydGhhbmQgb3IgbmVzdGVkIGZvcm0uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGx9IC0gTm9ybWFsaXplZCBuZXN0ZWQgcHJlbG9hZCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5lc3RlZFByZWxvYWQocHJlbG9hZCkge1xuICBpZiAoIXByZWxvYWQgfHwgdHlwZW9mIHByZWxvYWQgPT0gXCJib29sZWFuXCIpIHJldHVybiBudWxsXG5cbiAgaWYgKHR5cGVvZiBwcmVsb2FkID09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4ge1twcmVsb2FkXTogdHJ1ZX1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHByZWxvYWQpKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHByZWxvYWQpIHtcbiAgICAgIGlmICh0eXBlb2YgZW50cnkgPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXN1bHRbZW50cnldID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZEVudHJ5ID0gbm9ybWFsaXplTmVzdGVkUHJlbG9hZChlbnRyeSlcblxuICAgICAgICBpZiAobm9ybWFsaXplZEVudHJ5KSB7XG4gICAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMobm9ybWFsaXplZEVudHJ5KSkge1xuICAgICAgICAgICAgcmVzdWx0W2tleV0gPSB2YWx1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJlbG9hZCBlbnRyeSB0eXBlOiAke3R5cGVvZiBlbnRyeX1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIGlmIChwcmVsb2FkICYmIHR5cGVvZiBwcmVsb2FkID09IFwib2JqZWN0XCIpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWQpKSB7XG4gICAgICBpZiAodmFsdWUgPT09IHRydWUgfHwgdmFsdWUgPT09IGZhbHNlKSB7XG4gICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlID0gbm9ybWFsaXplTmVzdGVkUHJlbG9hZCh2YWx1ZSlcblxuICAgICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSkge1xuICAgICAgICByZXN1bHRba2V5XSA9IG5vcm1hbGl6ZWRWYWx1ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgdmFsdWUgZm9yICR7a2V5fTogJHt0eXBlb2YgdmFsdWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJlbG9hZCB0eXBlOiAke3R5cGVvZiBwcmVsb2FkfWApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQcmVsb2FkZXIge1xuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gb25lIG9yIG1vcmUgYWxyZWFkeS1sb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKiBBY2NlcHRzIGVpdGhlciBhIHF1ZXJ5IGJ1aWx0IHZpYSBgTW9kZWwucHJlbG9hZCguLi4pLnNlbGVjdCguLi4pYCAoaXRzXG4gICAqIHByZWxvYWQgZ3JhcGggYW5kIHNlbGVjdHMgYXJlIHVzZWQpIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IG1vZGVscyAtIE1vZGVsIGluc3RhbmNlcyB0byBwcmVsb2FkIG9udG8uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcXVlcnlPclNwZWMgLSBQcmVsb2FkIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwcmVsb2FkKG1vZGVscywgcXVlcnlPclNwZWMsIHtmb3JjZSA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKG1vZGVscy5sZW5ndGggPT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWxzWzBdLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGlzUXVlcnkgPSBCb29sZWFuKHF1ZXJ5T3JTcGVjKSAmJiB0eXBlb2YgcXVlcnlPclNwZWMgPT0gXCJvYmplY3RcIiAmJiBcIl9wcmVsb2FkXCIgaW4gcXVlcnlPclNwZWNcbiAgICAvLyBSZXVzZSB0aGUgcXVlcnkgYnVpbGRlcidzIHByZWxvYWQvc2VsZWN0IG5vcm1hbGl6YXRpb24gZm9yIHJhdyBzcGVjc1xuICAgIC8vIGluc3RlYWQgb2YgZHVwbGljYXRpbmcgaXQgaGVyZS5cbiAgICBjb25zdCBxdWVyeSA9IGlzUXVlcnlcbiAgICAgID8gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9ICovIChxdWVyeU9yU3BlYylcbiAgICAgIDogbW9kZWxDbGFzcy5wcmVsb2FkKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChxdWVyeU9yU3BlYykpXG5cbiAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVByZWxvYWRlcih7XG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgbW9kZWxzLFxuICAgICAgcHJlbG9hZDogcXVlcnkuX3ByZWxvYWQsXG4gICAgICBzZWxlY3Rpb246IG5ldyBQcmVsb2FkZXJTZWxlY3Rpb24oe1xuICAgICAgICBwcmVsb2FkU2VsZWN0czogcXVlcnkuX3ByZWxvYWRTZWxlY3RzLFxuICAgICAgICBwcmVsb2FkU2VsZWN0c0V4dHJhOiBxdWVyeS5fcHJlbG9hZFNlbGVjdHNFeHRyYSxcbiAgICAgICAgZm9yY2VcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGF3YWl0IHByZWxvYWRlci5ydW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSBhcmdzLm1vZGVscyAtIE1vZGVsIGluc3RhbmNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSBhcmdzLnByZWxvYWQgLSBQcmVsb2FkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gW2FyZ3MucHJlbG9hZFNlbGVjdHNdIC0gTmFycm93aW5nIHNlbGVjdHMga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbYXJncy5wcmVsb2FkU2VsZWN0c0V4dHJhXSAtIEV4dHJhIHNlbGVjdHMga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UHJlbG9hZGVyU2VsZWN0aW9ufSBbYXJncy5zZWxlY3Rpb25dIC0gUHJlLWJ1aWx0IHNlbGVjdGlvbiAodGFrZXMgcHJlY2VkZW5jZSBvdmVyIHRoZSBzZWxlY3QgbWFwcyB3aGVuIGdpdmVuKS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttb2RlbENsYXNzLCBtb2RlbHMsIHByZWxvYWQsIHByZWxvYWRTZWxlY3RzID0ge30sIHByZWxvYWRTZWxlY3RzRXh0cmEgPSB7fSwgc2VsZWN0aW9uLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMubW9kZWxzID0gbW9kZWxzXG4gICAgdGhpcy5wcmVsb2FkID0gcHJlbG9hZFxuICAgIHRoaXMuc2VsZWN0aW9uID0gc2VsZWN0aW9uIHx8IG5ldyBQcmVsb2FkZXJTZWxlY3Rpb24oe3ByZWxvYWRTZWxlY3RzLCBwcmVsb2FkU2VsZWN0c0V4dHJhfSlcbiAgfVxuXG4gIGFzeW5jIHJ1bigpIHtcbiAgICBmb3IgKGNvbnN0IHByZWxvYWRSZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMucHJlbG9hZCkge1xuICAgICAgY29uc3QgbW9kZWxDbGFzc1JlbGF0aW9uc2hpcCA9IHRoaXMubW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocHJlbG9hZFJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLm1vZGVscy5sZW5ndGggPiAwID8gbW9kZWxDbGFzc1JlbGF0aW9uc2hpcC5yZXNvbHZlRm9yUmVjb3JkKHRoaXMubW9kZWxzWzBdKSA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXBcblxuICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiB0aGlzLm1vZGVscykge1xuICAgICAgICBpZiAobW9kZWxDbGFzc1JlbGF0aW9uc2hpcC5yZXNvbHZlRm9yUmVjb3JkKG1vZGVsKSAhPT0gcmVsYXRpb25zaGlwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcHJlbG9hZCAke3RoaXMubW9kZWxDbGFzcy5uYW1lfSMke3ByZWxvYWRSZWxhdGlvbnNoaXBOYW1lfSBhY3Jvc3MgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdGllc2ApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxldCBwcmVsb2FkUmVzdWx0XG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgY29uc3QgYmVsb25nc1RvUmVsYXRpb25zaGlwID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQvcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCIpLmRlZmF1bHR9ICovIChyZWxhdGlvbnNoaXApXG4gICAgICAgIGNvbnN0IGhhc01hbnlQcmVsb2FkZXIgPSBuZXcgQmVsb25nc1RvUHJlbG9hZGVyKHttb2RlbHM6IHRoaXMubW9kZWxzLCByZWxhdGlvbnNoaXA6IGJlbG9uZ3NUb1JlbGF0aW9uc2hpcCwgc2VsZWN0aW9uOiB0aGlzLnNlbGVjdGlvbn0pXG5cbiAgICAgICAgcHJlbG9hZFJlc3VsdCA9IGF3YWl0IGhhc01hbnlQcmVsb2FkZXIucnVuKClcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBjb25zdCBoYXNNYW55UmVsYXRpb25zaGlwID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQvcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc1wiKS5kZWZhdWx0fSAqLyAocmVsYXRpb25zaGlwKVxuICAgICAgICBjb25zdCBoYXNNYW55UHJlbG9hZGVyID0gbmV3IEhhc01hbnlQcmVsb2FkZXIoe21vZGVsczogdGhpcy5tb2RlbHMsIHJlbGF0aW9uc2hpcDogaGFzTWFueVJlbGF0aW9uc2hpcCwgc2VsZWN0aW9uOiB0aGlzLnNlbGVjdGlvbn0pXG5cbiAgICAgICAgcHJlbG9hZFJlc3VsdCA9IGF3YWl0IGhhc01hbnlQcmVsb2FkZXIucnVuKClcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgICAgIGNvbnN0IGhhc09uZVJlbGF0aW9uc2hpcCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiKS5kZWZhdWx0fSAqLyAocmVsYXRpb25zaGlwKVxuICAgICAgICBjb25zdCBoYXNPbmVQcmVsb2FkZXIgPSBuZXcgSGFzT25lUHJlbG9hZGVyKHttb2RlbHM6IHRoaXMubW9kZWxzLCByZWxhdGlvbnNoaXA6IGhhc09uZVJlbGF0aW9uc2hpcCwgc2VsZWN0aW9uOiB0aGlzLnNlbGVjdGlvbn0pXG5cbiAgICAgICAgcHJlbG9hZFJlc3VsdCA9IGF3YWl0IGhhc09uZVByZWxvYWRlci5ydW4oKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke3JlbGF0aW9uc2hpcC5nZXRUeXBlKCl9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxzID0gQXJyYXkuaXNBcnJheShwcmVsb2FkUmVzdWx0KSA/IHByZWxvYWRSZXN1bHQgOiAocHJlbG9hZFJlc3VsdD8udGFyZ2V0TW9kZWxzIHx8IFtdKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWUgPSBBcnJheS5pc0FycmF5KHByZWxvYWRSZXN1bHQpID8gdW5kZWZpbmVkIDogcHJlbG9hZFJlc3VsdD8udGFyZ2V0TW9kZWxzQnlDbGFzc05hbWVcblxuICAgICAgLy8gSGFuZGxlIGFueSBmdXJ0aGVyIHByZWxvYWRzIGluIHRoZSB0cmVlXG4gICAgICBjb25zdCBuZXdQcmVsb2FkID0gdGhpcy5wcmVsb2FkW3ByZWxvYWRSZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgY29uc3Qgbm9ybWFsaXplZFByZWxvYWQgPSBub3JtYWxpemVOZXN0ZWRQcmVsb2FkKG5ld1ByZWxvYWQpXG5cbiAgICAgIGlmIChub3JtYWxpemVkUHJlbG9hZCAmJiB0YXJnZXRNb2RlbHMubGVuZ3RoID4gMCkge1xuICAgICAgICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkgJiYgdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWUpIHtcbiAgICAgICAgICBjb25zdCBjb25maWd1cmF0aW9uID0gcmVsYXRpb25zaGlwLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBjbGFzc05hbWUgaW4gdGFyZ2V0TW9kZWxzQnlDbGFzc05hbWUpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZGVscyA9IHRhcmdldE1vZGVsc0J5Q2xhc3NOYW1lW2NsYXNzTmFtZV1cblxuICAgICAgICAgICAgaWYgKG1vZGVscy5sZW5ndGggPT0gMCkgY29udGludWVcblxuICAgICAgICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzcyhjbGFzc05hbWUpKVxuICAgICAgICAgICAgY29uc3QgcHJlbG9hZGVyID0gbmV3IFZlbG9jaW91c0RhdGFiYXNlUXVlcnlQcmVsb2FkZXIoe21vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsIG1vZGVscywgcHJlbG9hZDogbm9ybWFsaXplZFByZWxvYWQsIHNlbGVjdGlvbjogdGhpcy5zZWxlY3Rpb259KVxuXG4gICAgICAgICAgICBhd2FpdCBwcmVsb2FkZXIucnVuKClcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgcmF3VGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIGJlIGdvdHRlbiBmcm9tIHJlbGF0aW9uc2hpcFwiKVxuXG4gICAgICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgICAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVByZWxvYWRlcih7bW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcywgbW9kZWxzOiB0YXJnZXRNb2RlbHMsIHByZWxvYWQ6IG5vcm1hbGl6ZWRQcmVsb2FkLCBzZWxlY3Rpb246IHRoaXMuc2VsZWN0aW9ufSlcblxuICAgICAgICAgIGF3YWl0IHByZWxvYWRlci5ydW4oKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=