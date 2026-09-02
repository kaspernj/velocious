// @ts-check
import Base from "./base.js";
import * as inflection from "inflection";
import validationMessage from "../validation-messages.js";
export default class VelociousDatabaseRecordValidatorsUniqueness extends Base {
    /**
     * Runs validate.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async validate({ model, attributeName }) {
        const modelClass = /** @type {typeof import("../index.js").default} */ (model.constructor);
        const connection = model.connection();
        const tableName = modelClass._getTable().getName();
        const attributeValue = /** @type {string | number} */ (model.readAttribute(attributeName));
        const attributeNameUnderscore = inflection.underscore(attributeName);
        /**
         * Where args.
         * @type {Record<string, string | number>} */
        const whereArgs = {};
        whereArgs[attributeNameUnderscore] = attributeValue;
        // Rails parity: `validates :attr, uniqueness: {scope: :other}` adds
        // the scoped column(s) to the WHERE clause so uniqueness is checked
        // within the given scope (e.g. `role` unique per `userId`).
        const scopeColumns = this._normalizeScopeColumns();
        for (const scopeColumn of scopeColumns) {
            const scopeUnderscore = inflection.underscore(scopeColumn);
            let scopeValue = model.readAttribute(scopeColumn);
            // When the FK hasn't been flushed from the relationship object
            // onto the attribute store yet (e.g. `new Task({project})` where
            // `projectId` is still undefined), try resolving it from the
            // loaded belongsTo relationship instead.
            if (scopeValue == null) {
                scopeValue = this._resolveScopeValueFromRelationship(model, scopeColumn);
            }
            if (scopeValue == null)
                return;
            whereArgs[scopeUnderscore] = /** @type {string | number} */ (scopeValue);
        }
        let existingRecordQuery = model
            .queryForModel(modelClass)
            .select(modelClass.primaryKey())
            .where(whereArgs);
        if (model.isPersisted()) {
            existingRecordQuery.where(`${connection.quoteTable(tableName)}.${connection.quoteColumn(modelClass.primaryKey())} != ${connection.quote(model.id())}`);
        }
        const existingRecord = await existingRecordQuery.first();
        if (existingRecord) {
            if (!(attributeName in model._validationErrors))
                model._validationErrors[attributeName] = [];
            const translator = modelClass._getConfiguration().getTranslator();
            model._validationErrors[attributeName].push({ type: "uniqueness", message: validationMessage({ translator, type: "taken" }) });
        }
    }
    /**
     * Try to resolve a scope column value from a loaded belongsTo
     * relationship on the model. When a Task is created via
     * `new Task({project})`, the FK (`projectId`) is only flushed onto
     * the attribute store during save — but the relationship object is
     * already loaded and carries the id we need for the WHERE clause.
     * @param {import("../index.js").default} model - Record whose loaded relationship may supply the scope value.
     * @param {string} scopeColumn - camelCase attribute name (e.g. `"projectId"`).
     * @returns {string | number | null} - Value normalized for comparison.
     */
    _resolveScopeValueFromRelationship(model, scopeColumn) {
        const modelClass = /** @type {typeof import("../index.js").default} */ (model.constructor);
        const relationships = modelClass.getRelationshipsMap();
        for (const relationshipName in relationships) {
            const relationship = relationships[relationshipName];
            if (relationship.getType?.() !== "belongsTo")
                continue;
            const foreignKey = inflection.camelize(relationship.getForeignKey(), true);
            if (foreignKey !== scopeColumn)
                continue;
            const instanceRelationship = model.getRelationshipByName(relationshipName);
            const loaded = instanceRelationship.loaded();
            if (loaded && !Array.isArray(loaded) && typeof loaded.id === "function") {
                return loaded.id();
            }
        }
        return null;
    }
    /**
     * Normalize the `scope` option into an array of attribute names.
     * Supports string (`"userId"`), array of strings (`["userId", "projectId"]`),
     * or absent (empty array — no scope, original single-column behavior).
     * @returns {string[]} - Columns participating in the uniqueness check.
     */
    _normalizeScopeColumns() {
        const scope = this.args?.scope;
        if (!scope)
            return [];
        if (Array.isArray(scope))
            return scope;
        return [String(scope)];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidW5pcXVlbmVzcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvdmFsaWRhdG9ycy91bmlxdWVuZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUV6RCxNQUFNLENBQUMsT0FBTyxPQUFPLDJDQUE0QyxTQUFRLElBQUk7SUFDM0U7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFDLEtBQUssRUFBRSxhQUFhLEVBQUM7UUFDbkMsTUFBTSxVQUFVLEdBQUcsbURBQW1ELENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUE7UUFFMUYsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ3JDLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNsRCxNQUFNLGNBQWMsR0FBRyw4QkFBOEIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQTtRQUMxRixNQUFNLHVCQUF1QixHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFcEU7O3FEQUU2QztRQUM3QyxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUE7UUFFcEIsU0FBUyxDQUFDLHVCQUF1QixDQUFDLEdBQUcsY0FBYyxDQUFBO1FBRW5ELG9FQUFvRTtRQUNwRSxvRUFBb0U7UUFDcEUsNERBQTREO1FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBRWxELEtBQUssTUFBTSxXQUFXLElBQUksWUFBWSxFQUFFLENBQUM7WUFDdkMsTUFB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QUFPLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQTtZQUNwQixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsc0JBQXNCO1FBQ3BCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFBO1FBRTlCLElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFDckIsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXRDLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtJQUN4QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB2YWxpZGF0aW9uTWVzc2FnZSBmcm9tIFwiLi4vdmFsaWRhdGlvbi1tZXNzYWdlcy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkVmFsaWRhdG9yc1VuaXF1ZW5lc3MgZXh0ZW5kcyBCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZSh7bW9kZWwsIGF0dHJpYnV0ZU5hbWV9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcblxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBtb2RlbC5jb25uZWN0aW9uKClcbiAgICBjb25zdCB0YWJsZU5hbWUgPSBtb2RlbENsYXNzLl9nZXRUYWJsZSgpLmdldE5hbWUoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVVbmRlcnNjb3JlID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAvKipcbiAgICAgKiBXaGVyZSBhcmdzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHdoZXJlQXJncyA9IHt9XG5cbiAgICB3aGVyZUFyZ3NbYXR0cmlidXRlTmFtZVVuZGVyc2NvcmVdID0gYXR0cmlidXRlVmFsdWVcblxuICAgIC8vIFJhaWxzIHBhcml0eTogYHZhbGlkYXRlcyA6YXR0ciwgdW5pcXVlbmVzczoge3Njb3BlOiA6b3RoZXJ9YCBhZGRzXG4gICAgLy8gdGhlIHNjb3BlZCBjb2x1bW4ocykgdG8gdGhlIFdIRVJFIGNsYXVzZSBzbyB1bmlxdWVuZXNzIGlzIGNoZWNrZWRcbiAgICAvLyB3aXRoaW4gdGhlIGdpdmVuIHNjb3BlIChlLmcuIGByb2xlYCB1bmlxdWUgcGVyIGB1c2VySWRgKS5cbiAgICBjb25zdCBzY29wZUNvbHVtbnMgPSB0aGlzLl9ub3JtYWxpemVTY29wZUNvbHVtbnMoKVxuXG4gICAgZm9yIChjb25zdCBzY29wZUNvbHVtbiBvZiBzY29wZUNvbHVtbnMpIHtcbiAgICAgIGNvbnN0IHNjb3BlVW5kZXJzY29yZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZShzY29wZUNvbHVtbilcbiAgICAgIGxldCBzY29wZVZhbHVlID0gbW9kZWwucmVhZEF0dHJpYnV0ZShzY29wZUNvbHVtbilcblxuICAgICAgLy8gV2hlbiB0aGUgRksgaGFzbid0IGJlZW4gZmx1c2hlZCBmcm9tIHRoZSByZWxhdGlvbnNoaXAgb2JqZWN0XG4gICAgICAvLyBvbnRvIHRoZSBhdHRyaWJ1dGUgc3RvcmUgeWV0IChlLmcuIGBuZXcgVGFzayh7cHJvamVjdH0pYCB3aGVyZVxuICAgICAgLy8gYHByb2plY3RJZGAgaXMgc3RpbGwgdW5kZWZpbmVkKSwgdHJ5IHJlc29sdmluZyBpdCBmcm9tIHRoZVxuICAgICAgLy8gbG9hZGVkIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgaW5zdGVhZC5cbiAgICAgIGlmIChzY29wZVZhbHVlID09IG51bGwpIHtcbiAgICAgICAgc2NvcGVWYWx1ZSA9IHRoaXMuX3Jlc29sdmVTY29wZVZhbHVlRnJvbVJlbGF0aW9uc2hpcChtb2RlbCwgc2NvcGVDb2x1bW4pXG4gICAgICB9XG5cbiAgICAgIGlmIChzY29wZVZhbHVlID09IG51bGwpIHJldHVyblxuXG4gICAgICB3aGVyZUFyZ3Nbc2NvcGVVbmRlcnNjb3JlXSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAoc2NvcGVWYWx1ZSlcbiAgICB9XG5cbiAgICBsZXQgZXhpc3RpbmdSZWNvcmRRdWVyeSA9IG1vZGVsXG4gICAgICAucXVlcnlGb3JNb2RlbChtb2RlbENsYXNzKVxuICAgICAgLnNlbGVjdChtb2RlbENsYXNzLnByaW1hcnlLZXkoKSlcbiAgICAgIC53aGVyZSh3aGVyZUFyZ3MpXG5cbiAgICBpZiAobW9kZWwuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgZXhpc3RpbmdSZWNvcmRRdWVyeS53aGVyZShgJHtjb25uZWN0aW9uLnF1b3RlVGFibGUodGFibGVOYW1lKX0uJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpKX0gIT0gJHtjb25uZWN0aW9uLnF1b3RlKG1vZGVsLmlkKCkpfWApXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdSZWNvcmQgPSBhd2FpdCBleGlzdGluZ1JlY29yZFF1ZXJ5LmZpcnN0KClcblxuICAgIGlmIChleGlzdGluZ1JlY29yZCkge1xuICAgICAgaWYgKCEoYXR0cmlidXRlTmFtZSBpbiBtb2RlbC5fdmFsaWRhdGlvbkVycm9ycykpIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgY29uc3QgdHJhbnNsYXRvciA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRUcmFuc2xhdG9yKClcblxuICAgICAgbW9kZWwuX3ZhbGlkYXRpb25FcnJvcnNbYXR0cmlidXRlTmFtZV0ucHVzaCh7dHlwZTogXCJ1bmlxdWVuZXNzXCIsIG1lc3NhZ2U6IHZhbGlkYXRpb25NZXNzYWdlKHt0cmFuc2xhdG9yLCB0eXBlOiBcInRha2VuXCJ9KX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRyeSB0byByZXNvbHZlIGEgc2NvcGUgY29sdW1uIHZhbHVlIGZyb20gYSBsb2FkZWQgYmVsb25nc1RvXG4gICAqIHJlbGF0aW9uc2hpcCBvbiB0aGUgbW9kZWwuIFdoZW4gYSBUYXNrIGlzIGNyZWF0ZWQgdmlhXG4gICAqIGBuZXcgVGFzayh7cHJvamVjdH0pYCwgdGhlIEZLIChgcHJvamVjdElkYCkgaXMgb25seSBmbHVzaGVkIG9udG9cbiAgICogdGhlIGF0dHJpYnV0ZSBzdG9yZSBkdXJpbmcgc2F2ZSDigJQgYnV0IHRoZSByZWxhdGlvbnNoaXAgb2JqZWN0IGlzXG4gICAqIGFscmVhZHkgbG9hZGVkIGFuZCBjYXJyaWVzIHRoZSBpZCB3ZSBuZWVkIGZvciB0aGUgV0hFUkUgY2xhdXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gUmVjb3JkIHdob3NlIGxvYWRlZCByZWxhdGlvbnNoaXAgbWF5IHN1cHBseSB0aGUgc2NvcGUgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZUNvbHVtbiAtIGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZSAoZS5nLiBgXCJwcm9qZWN0SWRcImApLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gLSBWYWx1ZSBub3JtYWxpemVkIGZvciBjb21wYXJpc29uLlxuICAgKi9cbiAgX3Jlc29sdmVTY29wZVZhbHVlRnJvbVJlbGF0aW9uc2hpcChtb2RlbCwgc2NvcGVDb2x1bW4pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlPy4oKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKSwgdHJ1ZSlcblxuICAgICAgaWYgKGZvcmVpZ25LZXkgIT09IHNjb3BlQ29sdW1uKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKGxvYWRlZCAmJiAhQXJyYXkuaXNBcnJheShsb2FkZWQpICYmIHR5cGVvZiBsb2FkZWQuaWQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gbG9hZGVkLmlkKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZSB0aGUgYHNjb3BlYCBvcHRpb24gaW50byBhbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqIFN1cHBvcnRzIHN0cmluZyAoYFwidXNlcklkXCJgKSwgYXJyYXkgb2Ygc3RyaW5ncyAoYFtcInVzZXJJZFwiLCBcInByb2plY3RJZFwiXWApLFxuICAgKiBvciBhYnNlbnQgKGVtcHR5IGFycmF5IOKAlCBubyBzY29wZSwgb3JpZ2luYWwgc2luZ2xlLWNvbHVtbiBiZWhhdmlvcikuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBDb2x1bW5zIHBhcnRpY2lwYXRpbmcgaW4gdGhlIHVuaXF1ZW5lc3MgY2hlY2suXG4gICAqL1xuICBfbm9ybWFsaXplU2NvcGVDb2x1bW5zKCkge1xuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5hcmdzPy5zY29wZVxuXG4gICAgaWYgKCFzY29wZSkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc2NvcGUpKSByZXR1cm4gc2NvcGVcblxuICAgIHJldHVybiBbU3RyaW5nKHNjb3BlKV1cbiAgfVxufVxuIl19