// @ts-check
import Base from "./base.js";
import * as inflection from "inflection";
import { modelPrimaryKeyConditions, scalarModelPrimaryKeyValue } from "../../../utils/model-primary-key.js";
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
            existingRecordQuery.whereNot(modelPrimaryKeyConditions(modelClass.primaryKey(), model._persistedPrimaryKeyValue()));
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
                return scalarModelPrimaryKeyValue(loaded.id(), `Uniqueness scope relationship for ${modelClass.name}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidW5pcXVlbmVzcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvdmFsaWRhdG9ycy91bmlxdWVuZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLHlCQUF5QixFQUFFLDBCQUEwQixFQUFDLE1BQU0scUNBQXFDLENBQUE7QUFDekcsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUV6RCxNQUFNLENBQUMsT0FBTyxPQUFPLDJDQUE0QyxTQUFRLElBQUk7SUFDM0U7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFDLEtBQUssRUFBRSxhQUFhLEVBQUM7UUFDbkMsTUFBTSxVQUFVLEdBQUcsbURBQW1ELENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUE7UUFFMUYsTUFBTSxjQUFjLEdBQUcsOEJBQThCLENBQUMsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUE7UUFDMUYsTUFBTSx1QkFBdUIsR0FBRyxVQUFVLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRXBFOztxREFFNkM7UUFDN0MsTUFBTSxTQUFTLEdBQUcsRUFBRSxDQUFBO1FBRXBCLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQyxHQUFHLGNBQWMsQ0FBQTtRQUVuRCxvRUFBb0U7UUFDcEUsb0VBQW9FO1FBQ3BFLDREQUE0RDtRQUM1RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUVsRCxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLENBQUE7WUFD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QUM7SUFFRDs7Ozs7T0FLRztJQUNILHNCQUFzQjtRQUNwQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQTtRQUU5QixJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sRUFBRSxDQUFBO1FBQ3JCLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUV0QyxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDeEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlIGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHZhbGlkYXRpb25NZXNzYWdlIGZyb20gXCIuLi92YWxpZGF0aW9uLW1lc3NhZ2VzLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRWYWxpZGF0b3JzVW5pcXVlbmVzcyBleHRlbmRzIEJhc2Uge1xuICAvKipcbiAgICogUnVucyB2YWxpZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHZhbGlkYXRlKHttb2RlbCwgYXR0cmlidXRlTmFtZX0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsLmNvbnN0cnVjdG9yKVxuXG4gICAgY29uc3QgYXR0cmlidXRlVmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKG1vZGVsLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVVuZGVyc2NvcmUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoYXR0cmlidXRlTmFtZSlcblxuICAgIC8qKlxuICAgICAqIFdoZXJlIGFyZ3MuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59ICovXG4gICAgY29uc3Qgd2hlcmVBcmdzID0ge31cblxuICAgIHdoZXJlQXJnc1thdHRyaWJ1dGVOYW1lVW5kZXJzY29yZV0gPSBhdHRyaWJ1dGVWYWx1ZVxuXG4gICAgLy8gUmFpbHMgcGFyaXR5OiBgdmFsaWRhdGVzIDphdHRyLCB1bmlxdWVuZXNzOiB7c2NvcGU6IDpvdGhlcn1gIGFkZHNcbiAgICAvLyB0aGUgc2NvcGVkIGNvbHVtbihzKSB0byB0aGUgV0hFUkUgY2xhdXNlIHNvIHVuaXF1ZW5lc3MgaXMgY2hlY2tlZFxuICAgIC8vIHdpdGhpbiB0aGUgZ2l2ZW4gc2NvcGUgKGUuZy4gYHJvbGVgIHVuaXF1ZSBwZXIgYHVzZXJJZGApLlxuICAgIGNvbnN0IHNjb3BlQ29sdW1ucyA9IHRoaXMuX25vcm1hbGl6ZVNjb3BlQ29sdW1ucygpXG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlQ29sdW1uIG9mIHNjb3BlQ29sdW1ucykge1xuICAgICAgY29uc3Qgc2NvcGVVbmRlcnNjb3JlID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKHNjb3BlQ29sdW1uKVxuICAgICAgbGV0IHNjb3BlVmFsdWUgPSBtb2RlbC5yZWFkQXR0cmlidXRlKHNjb3BlQ29sdW1uKVxuXG4gICAgICAvLyBXaGVuIHRoZSBGSyBoYXNuJ3QgYmVlbiBmbHVzaGVkIGZyb20gdGhlIHJlbGF0aW9uc2hpcCBvYmplY3RcbiAgICAgIC8vIG9udG8gdGhlIGF0dHJpYnV0ZSBzdG9yZSB5ZXQgKGUuZy4gYG5ldyBUYXNrKHtwcm9qZWN0fSlgIHdoZXJlXG4gICAgICAvLyBgcHJvamVjdElkYCBpcyBzdGlsbCB1bmRlZmluZWQpLCB0cnkgcmVzb2x2aW5nIGl0IGZyb20gdGhlXG4gICAgICAvLyBsb2FkZWQgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCBpbnN0ZWFkLlxuICAgICAgaWYgKHNjb3BlVmFsdWUgPT0gbnVsbCkge1xuICAgICAgICBzY29wZVZhbHVlID0gdGhpcy5fcmVzb2x2ZVNjb3BlVmFsdWVGcm9tUmVsYXRpb25zaGlwKG1vZGVsLCBzY29wZUNvbHVtbilcbiAgICAgIH1cblxuICAgICAgaWYgKHNjb3BlVmFsdWUgPT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgIHdoZXJlQXJnc1tzY29wZVVuZGVyc2NvcmVdID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChzY29wZVZhbHVlKVxuICAgIH1cblxuICAgIGxldCBleGlzdGluZ1JlY29yZFF1ZXJ5ID0gbW9kZWxcbiAgICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsQ2xhc3MpXG4gICAgICAuc2VsZWN0KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpKVxuICAgICAgLndoZXJlKHdoZXJlQXJncylcblxuICAgIGlmIChtb2RlbC5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICBleGlzdGluZ1JlY29yZFF1ZXJ5LndoZXJlTm90KG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMobW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIG1vZGVsLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSkpXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdSZWNvcmQgPSBhd2FpdCBleGlzdGluZ1JlY29yZFF1ZXJ5LmZpcnN0KClcblxuICAgIGlmIChleGlzdGluZ1JlY29yZCkge1xuICAgICAgaWYgKCEoYXR0cmlidXRlTmFtZSBpbiBtb2RlbC5fdmFsaWRhdGlvbkVycm9ycykpIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgY29uc3QgdHJhbnNsYXRvciA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRUcmFuc2xhdG9yKClcblxuICAgICAgbW9kZWwuX3ZhbGlkYXRpb25FcnJvcnNbYXR0cmlidXRlTmFtZV0ucHVzaCh7dHlwZTogXCJ1bmlxdWVuZXNzXCIsIG1lc3NhZ2U6IHZhbGlkYXRpb25NZXNzYWdlKHt0cmFuc2xhdG9yLCB0eXBlOiBcInRha2VuXCJ9KX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRyeSB0byByZXNvbHZlIGEgc2NvcGUgY29sdW1uIHZhbHVlIGZyb20gYSBsb2FkZWQgYmVsb25nc1RvXG4gICAqIHJlbGF0aW9uc2hpcCBvbiB0aGUgbW9kZWwuIFdoZW4gYSBUYXNrIGlzIGNyZWF0ZWQgdmlhXG4gICAqIGBuZXcgVGFzayh7cHJvamVjdH0pYCwgdGhlIEZLIChgcHJvamVjdElkYCkgaXMgb25seSBmbHVzaGVkIG9udG9cbiAgICogdGhlIGF0dHJpYnV0ZSBzdG9yZSBkdXJpbmcgc2F2ZSDigJQgYnV0IHRoZSByZWxhdGlvbnNoaXAgb2JqZWN0IGlzXG4gICAqIGFscmVhZHkgbG9hZGVkIGFuZCBjYXJyaWVzIHRoZSBpZCB3ZSBuZWVkIGZvciB0aGUgV0hFUkUgY2xhdXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gUmVjb3JkIHdob3NlIGxvYWRlZCByZWxhdGlvbnNoaXAgbWF5IHN1cHBseSB0aGUgc2NvcGUgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZUNvbHVtbiAtIGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZSAoZS5nLiBgXCJwcm9qZWN0SWRcImApLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gLSBWYWx1ZSBub3JtYWxpemVkIGZvciBjb21wYXJpc29uLlxuICAgKi9cbiAgX3Jlc29sdmVTY29wZVZhbHVlRnJvbVJlbGF0aW9uc2hpcChtb2RlbCwgc2NvcGVDb2x1bW4pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlPy4oKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKSwgdHJ1ZSlcblxuICAgICAgaWYgKGZvcmVpZ25LZXkgIT09IHNjb3BlQ29sdW1uKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKGxvYWRlZCAmJiAhQXJyYXkuaXNBcnJheShsb2FkZWQpICYmIHR5cGVvZiBsb2FkZWQuaWQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUobG9hZGVkLmlkKCksIGBVbmlxdWVuZXNzIHNjb3BlIHJlbGF0aW9uc2hpcCBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZSB0aGUgYHNjb3BlYCBvcHRpb24gaW50byBhbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqIFN1cHBvcnRzIHN0cmluZyAoYFwidXNlcklkXCJgKSwgYXJyYXkgb2Ygc3RyaW5ncyAoYFtcInVzZXJJZFwiLCBcInByb2plY3RJZFwiXWApLFxuICAgKiBvciBhYnNlbnQgKGVtcHR5IGFycmF5IOKAlCBubyBzY29wZSwgb3JpZ2luYWwgc2luZ2xlLWNvbHVtbiBiZWhhdmlvcikuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBDb2x1bW5zIHBhcnRpY2lwYXRpbmcgaW4gdGhlIHVuaXF1ZW5lc3MgY2hlY2suXG4gICAqL1xuICBfbm9ybWFsaXplU2NvcGVDb2x1bW5zKCkge1xuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5hcmdzPy5zY29wZVxuXG4gICAgaWYgKCFzY29wZSkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc2NvcGUpKSByZXR1cm4gc2NvcGVcblxuICAgIHJldHVybiBbU3RyaW5nKHNjb3BlKV1cbiAgfVxufVxuIl19