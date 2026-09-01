// @ts-check
/**
 * An immutable compiled trait. A trait carries an ordered list of declarations
 * (attributes, transients, associations, callbacks, custom construction, and
 * base-trait inclusions) that are mixed into a factory run.
 */
export default class TraitDefinition {
    /**
     * Builds a trait definition.
     * @param {object} args - Options.
     * @param {string} args.name - Trait name.
     * @param {import("./declarations.js").Declaration[]} args.declarations - Ordered declarations.
     */
    constructor({ name, declarations }) {
        /** @type {string} - Trait name. */
        this.name = name;
        /** @type {Array<import("./declarations.js").Declaration>} - Ordered declarations. */
        this.declarations = /** @type {Array<import("./declarations.js").Declaration>} */ (Object.freeze([...declarations]));
        Object.freeze(this);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhaXQtZGVmaW5pdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL2ZhY3RvcnkvdHJhaXQtZGVmaW5pdGlvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZUFBZTtJQUNsQzs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxJQUFJLEVBQUUsWUFBWSxFQUFDO1FBQzlCLG1DQUFtQztRQUNuQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUVoQixxRkFBcUY7UUFDckYsSUFBSSxDQUFDLFlBQVksR0FBRyw2REFBNkQsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVwSCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3JCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEFuIGltbXV0YWJsZSBjb21waWxlZCB0cmFpdC4gQSB0cmFpdCBjYXJyaWVzIGFuIG9yZGVyZWQgbGlzdCBvZiBkZWNsYXJhdGlvbnNcbiAqIChhdHRyaWJ1dGVzLCB0cmFuc2llbnRzLCBhc3NvY2lhdGlvbnMsIGNhbGxiYWNrcywgY3VzdG9tIGNvbnN0cnVjdGlvbiwgYW5kXG4gKiBiYXNlLXRyYWl0IGluY2x1c2lvbnMpIHRoYXQgYXJlIG1peGVkIGludG8gYSBmYWN0b3J5IHJ1bi5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVHJhaXREZWZpbml0aW9uIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHRyYWl0IGRlZmluaXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubmFtZSAtIFRyYWl0IG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuRGVjbGFyYXRpb25bXX0gYXJncy5kZWNsYXJhdGlvbnMgLSBPcmRlcmVkIGRlY2xhcmF0aW9ucy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtuYW1lLCBkZWNsYXJhdGlvbnN9KSB7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmd9IC0gVHJhaXQgbmFtZS4gKi9cbiAgICB0aGlzLm5hbWUgPSBuYW1lXG5cbiAgICAvKiogQHR5cGUge0FycmF5PGltcG9ydChcIi4vZGVjbGFyYXRpb25zLmpzXCIpLkRlY2xhcmF0aW9uPn0gLSBPcmRlcmVkIGRlY2xhcmF0aW9ucy4gKi9cbiAgICB0aGlzLmRlY2xhcmF0aW9ucyA9IC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuRGVjbGFyYXRpb24+fSAqLyAoT2JqZWN0LmZyZWV6ZShbLi4uZGVjbGFyYXRpb25zXSkpXG5cbiAgICBPYmplY3QuZnJlZXplKHRoaXMpXG4gIH1cbn1cbiJdfQ==