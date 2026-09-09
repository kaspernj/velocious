import Base from "./base.js";
export default class VelociousDatabaseRecordValidatorsUniqueness extends Base {
    /**
     * Runs validate.
     * @param {object} args - Options object.
     * @param {import("../index.js").default} args.model - Model instance.
     * @param {string} args.attributeName - Attribute name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    validate({ model, attributeName }: {
        model: import("../index.js").default;
        attributeName: string;
    }): Promise<void>;
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
    _resolveScopeValueFromRelationship(model: import("../index.js").default, scopeColumn: string): string | number | null;
    /**
     * Normalize the `scope` option into an array of attribute names.
     * Supports string (`"userId"`), array of strings (`["userId", "projectId"]`),
     * or absent (empty array — no scope, original single-column behavior).
     * @returns {string[]} - Columns participating in the uniqueness check.
     */
    _normalizeScopeColumns(): string[];
}
//# sourceMappingURL=uniqueness.d.ts.map