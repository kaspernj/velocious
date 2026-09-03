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
            existingRecordQuery.whereNot(modelPrimaryKeyConditions(modelClass.primaryKey(), model.id()));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidW5pcXVlbmVzcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvdmFsaWRhdG9ycy91bmlxdWVuZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLHlCQUF5QixFQUFFLDBCQUEwQixFQUFDLE1BQU0scUNBQXFDLENBQUE7QUFDekcsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUV6RCxNQUFNLENBQUMsT0FBTyxPQUFPLDJDQUE0QyxTQUFRLElBQUk7SUFDM0U7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFDLEtBQUssRUFBRSxhQUFhLEVBQUM7UUFDbkMsTUFBTSxVQUFVLEdBQUcsbURBQW1ELENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUE7UUFFMUYsTUFBTSxjQUFjLEdBQUcsOEJBQThCLENBQUMsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUE7UUFDMUYsTUFBTSx1QkFBdUIsR0FBRyxVQUFVLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRXBFOztxREFFNkM7UUFDN0MsTUFBTSxTQUFTLEdBQUcsRUFBRSxDQUFBO1FBRXBCLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQyxHQUFHLGNBQWMsQ0FBQTtRQUVuRCxvRUFBb0U7UUFDcEUsb0VBQW9FO1FBQ3BFLDREQUE0RDtRQUM1RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUVsRCxLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLENBQUE7WUFD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O0lBRUQ7Ozs7O09BS0c7SUFDSCxzQkFBc0I7UUFDcEIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUE7UUFFOUIsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUNyQixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFdEMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0lBQ3hCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uLy4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB2YWxpZGF0aW9uTWVzc2FnZSBmcm9tIFwiLi4vdmFsaWRhdGlvbi1tZXNzYWdlcy5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkVmFsaWRhdG9yc1VuaXF1ZW5lc3MgZXh0ZW5kcyBCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZSh7bW9kZWwsIGF0dHJpYnV0ZU5hbWV9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcblxuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVVbmRlcnNjb3JlID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAvKipcbiAgICAgKiBXaGVyZSBhcmdzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHdoZXJlQXJncyA9IHt9XG5cbiAgICB3aGVyZUFyZ3NbYXR0cmlidXRlTmFtZVVuZGVyc2NvcmVdID0gYXR0cmlidXRlVmFsdWVcblxuICAgIC8vIFJhaWxzIHBhcml0eTogYHZhbGlkYXRlcyA6YXR0ciwgdW5pcXVlbmVzczoge3Njb3BlOiA6b3RoZXJ9YCBhZGRzXG4gICAgLy8gdGhlIHNjb3BlZCBjb2x1bW4ocykgdG8gdGhlIFdIRVJFIGNsYXVzZSBzbyB1bmlxdWVuZXNzIGlzIGNoZWNrZWRcbiAgICAvLyB3aXRoaW4gdGhlIGdpdmVuIHNjb3BlIChlLmcuIGByb2xlYCB1bmlxdWUgcGVyIGB1c2VySWRgKS5cbiAgICBjb25zdCBzY29wZUNvbHVtbnMgPSB0aGlzLl9ub3JtYWxpemVTY29wZUNvbHVtbnMoKVxuXG4gICAgZm9yIChjb25zdCBzY29wZUNvbHVtbiBvZiBzY29wZUNvbHVtbnMpIHtcbiAgICAgIGNvbnN0IHNjb3BlVW5kZXJzY29yZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZShzY29wZUNvbHVtbilcbiAgICAgIGxldCBzY29wZVZhbHVlID0gbW9kZWwucmVhZEF0dHJpYnV0ZShzY29wZUNvbHVtbilcblxuICAgICAgLy8gV2hlbiB0aGUgRksgaGFzbid0IGJlZW4gZmx1c2hlZCBmcm9tIHRoZSByZWxhdGlvbnNoaXAgb2JqZWN0XG4gICAgICAvLyBvbnRvIHRoZSBhdHRyaWJ1dGUgc3RvcmUgeWV0IChlLmcuIGBuZXcgVGFzayh7cHJvamVjdH0pYCB3aGVyZVxuICAgICAgLy8gYHByb2plY3RJZGAgaXMgc3RpbGwgdW5kZWZpbmVkKSwgdHJ5IHJlc29sdmluZyBpdCBmcm9tIHRoZVxuICAgICAgLy8gbG9hZGVkIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgaW5zdGVhZC5cbiAgICAgIGlmIChzY29wZVZhbHVlID09IG51bGwpIHtcbiAgICAgICAgc2NvcGVWYWx1ZSA9IHRoaXMuX3Jlc29sdmVTY29wZVZhbHVlRnJvbVJlbGF0aW9uc2hpcChtb2RlbCwgc2NvcGVDb2x1bW4pXG4gICAgICB9XG5cbiAgICAgIGlmIChzY29wZVZhbHVlID09IG51bGwpIHJldHVyblxuXG4gICAgICB3aGVyZUFyZ3Nbc2NvcGVVbmRlcnNjb3JlXSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAoc2NvcGVWYWx1ZSlcbiAgICB9XG5cbiAgICBsZXQgZXhpc3RpbmdSZWNvcmRRdWVyeSA9IG1vZGVsXG4gICAgICAucXVlcnlGb3JNb2RlbChtb2RlbENsYXNzKVxuICAgICAgLnNlbGVjdChtb2RlbENsYXNzLnByaW1hcnlLZXkoKSlcbiAgICAgIC53aGVyZSh3aGVyZUFyZ3MpXG5cbiAgICBpZiAobW9kZWwuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgZXhpc3RpbmdSZWNvcmRRdWVyeS53aGVyZU5vdChtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBtb2RlbC5pZCgpKSlcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1JlY29yZCA9IGF3YWl0IGV4aXN0aW5nUmVjb3JkUXVlcnkuZmlyc3QoKVxuXG4gICAgaWYgKGV4aXN0aW5nUmVjb3JkKSB7XG4gICAgICBpZiAoIShhdHRyaWJ1dGVOYW1lIGluIG1vZGVsLl92YWxpZGF0aW9uRXJyb3JzKSkgbW9kZWwuX3ZhbGlkYXRpb25FcnJvcnNbYXR0cmlidXRlTmFtZV0gPSBbXVxuXG4gICAgICBjb25zdCB0cmFuc2xhdG9yID0gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldFRyYW5zbGF0b3IoKVxuXG4gICAgICBtb2RlbC5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHt0eXBlOiBcInVuaXF1ZW5lc3NcIiwgbWVzc2FnZTogdmFsaWRhdGlvbk1lc3NhZ2Uoe3RyYW5zbGF0b3IsIHR5cGU6IFwidGFrZW5cIn0pfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJ5IHRvIHJlc29sdmUgYSBzY29wZSBjb2x1bW4gdmFsdWUgZnJvbSBhIGxvYWRlZCBiZWxvbmdzVG9cbiAgICogcmVsYXRpb25zaGlwIG9uIHRoZSBtb2RlbC4gV2hlbiBhIFRhc2sgaXMgY3JlYXRlZCB2aWFcbiAgICogYG5ldyBUYXNrKHtwcm9qZWN0fSlgLCB0aGUgRksgKGBwcm9qZWN0SWRgKSBpcyBvbmx5IGZsdXNoZWQgb250b1xuICAgKiB0aGUgYXR0cmlidXRlIHN0b3JlIGR1cmluZyBzYXZlIOKAlCBidXQgdGhlIHJlbGF0aW9uc2hpcCBvYmplY3QgaXNcbiAgICogYWxyZWFkeSBsb2FkZWQgYW5kIGNhcnJpZXMgdGhlIGlkIHdlIG5lZWQgZm9yIHRoZSBXSEVSRSBjbGF1c2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBSZWNvcmQgd2hvc2UgbG9hZGVkIHJlbGF0aW9uc2hpcCBtYXkgc3VwcGx5IHRoZSBzY29wZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlQ29sdW1uIC0gY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lIChlLmcuIGBcInByb2plY3RJZFwiYCkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSAtIFZhbHVlIG5vcm1hbGl6ZWQgZm9yIGNvbXBhcmlzb24uXG4gICAqL1xuICBfcmVzb2x2ZVNjb3BlVmFsdWVGcm9tUmVsYXRpb25zaGlwKG1vZGVsLCBzY29wZUNvbHVtbikge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgaW4gcmVsYXRpb25zaGlwcykge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGU/LigpICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5ID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpLCB0cnVlKVxuXG4gICAgICBpZiAoZm9yZWlnbktleSAhPT0gc2NvcGVDb2x1bW4pIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICBpZiAobG9hZGVkICYmICFBcnJheS5pc0FycmF5KGxvYWRlZCkgJiYgdHlwZW9mIGxvYWRlZC5pZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShsb2FkZWQuaWQoKSwgYFVuaXF1ZW5lc3Mgc2NvcGUgcmVsYXRpb25zaGlwIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplIHRoZSBgc2NvcGVgIG9wdGlvbiBpbnRvIGFuIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogU3VwcG9ydHMgc3RyaW5nIChgXCJ1c2VySWRcImApLCBhcnJheSBvZiBzdHJpbmdzIChgW1widXNlcklkXCIsIFwicHJvamVjdElkXCJdYCksXG4gICAqIG9yIGFic2VudCAoZW1wdHkgYXJyYXkg4oCUIG5vIHNjb3BlLCBvcmlnaW5hbCBzaW5nbGUtY29sdW1uIGJlaGF2aW9yKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIENvbHVtbnMgcGFydGljaXBhdGluZyBpbiB0aGUgdW5pcXVlbmVzcyBjaGVjay5cbiAgICovXG4gIF9ub3JtYWxpemVTY29wZUNvbHVtbnMoKSB7XG4gICAgY29uc3Qgc2NvcGUgPSB0aGlzLmFyZ3M/LnNjb3BlXG5cbiAgICBpZiAoIXNjb3BlKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheShzY29wZSkpIHJldHVybiBzY29wZVxuXG4gICAgcmV0dXJuIFtTdHJpbmcoc2NvcGUpXVxuICB9XG59XG4iXX0=