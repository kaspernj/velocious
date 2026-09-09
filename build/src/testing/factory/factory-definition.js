// @ts-check
/**
 * An immutable compiled factory. Definitions never mutate after compilation;
 * `modify` produces a replacement rather than editing an existing one. Parent and
 * trait references are resolved lazily at evaluation time, so a child may be
 * declared before its parent.
 */
export default class FactoryDefinition {
    /**
     * Builds a factory definition.
     * @param {object} args - Options.
     * @param {string} args.name - Factory name.
     * @param {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} args.modelClass - Model class, or null to inherit from a parent.
     * @param {string | null} args.parentName - Parent factory name, or null.
     * @param {string[]} args.aliases - Alias names that reference this same definition.
     * @param {import("./declarations.js").Declaration[]} args.declarations - Ordered own declarations.
     * @param {Map<string, import("./trait-definition.js").default>} args.localTraits - Factory-local traits keyed by name.
     */
    constructor({ name, modelClass, parentName, aliases, declarations, localTraits }) {
        /** @type {string} - Factory name. */
        this.name = name;
        /** @type {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} - Model class or null. */
        this.modelClass = modelClass;
        /** @type {string | null} - Parent factory name or null. */
        this.parentName = parentName;
        /** @type {Array<string>} - Alias names. */
        this.aliases = /** @type {Array<string>} */ (Object.freeze([...aliases]));
        /** @type {Array<import("./declarations.js").Declaration>} - Ordered own declarations. */
        this.declarations = /** @type {Array<import("./declarations.js").Declaration>} */ (Object.freeze([...declarations]));
        /** @type {Map<string, import("./trait-definition.js").default>} - Factory-local traits. */
        this.localTraits = localTraits;
        Object.freeze(this);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFjdG9yeS1kZWZpbml0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZmFjdG9yeS9mYWN0b3J5LWRlZmluaXRpb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7OztHQUtHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQkFBaUI7SUFDcEM7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUUsV0FBVyxFQUFDO1FBQzVFLHFDQUFxQztRQUNyQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUVoQixnSkFBZ0o7UUFDaEosSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7UUFFNUIsMkRBQTJEO1FBQzNELElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBRTVCLDJDQUEyQztRQUMzQyxJQUFJLENBQUMsT0FBTyxHQUFHLDRCQUE0QixDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXpFLHlGQUF5RjtRQUN6RixJQUFJLENBQUMsWUFBWSxHQUFHLDZEQUE2RCxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXBILDJGQUEyRjtRQUMzRixJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUU5QixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3JCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEFuIGltbXV0YWJsZSBjb21waWxlZCBmYWN0b3J5LiBEZWZpbml0aW9ucyBuZXZlciBtdXRhdGUgYWZ0ZXIgY29tcGlsYXRpb247XG4gKiBgbW9kaWZ5YCBwcm9kdWNlcyBhIHJlcGxhY2VtZW50IHJhdGhlciB0aGFuIGVkaXRpbmcgYW4gZXhpc3Rpbmcgb25lLiBQYXJlbnQgYW5kXG4gKiB0cmFpdCByZWZlcmVuY2VzIGFyZSByZXNvbHZlZCBsYXppbHkgYXQgZXZhbHVhdGlvbiB0aW1lLCBzbyBhIGNoaWxkIG1heSBiZVxuICogZGVjbGFyZWQgYmVmb3JlIGl0cyBwYXJlbnQuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZhY3RvcnlEZWZpbml0aW9uIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGZhY3RvcnkgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5uYW1lIC0gRmFjdG9yeSBuYW1lLlxuICAgKiBAcGFyYW0geyhuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSB8IG51bGx9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLCBvciBudWxsIHRvIGluaGVyaXQgZnJvbSBhIHBhcmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLnBhcmVudE5hbWUgLSBQYXJlbnQgZmFjdG9yeSBuYW1lLCBvciBudWxsLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmFsaWFzZXMgLSBBbGlhcyBuYW1lcyB0aGF0IHJlZmVyZW5jZSB0aGlzIHNhbWUgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5EZWNsYXJhdGlvbltdfSBhcmdzLmRlY2xhcmF0aW9ucyAtIE9yZGVyZWQgb3duIGRlY2xhcmF0aW9ucy5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3RyYWl0LWRlZmluaXRpb24uanNcIikuZGVmYXVsdD59IGFyZ3MubG9jYWxUcmFpdHMgLSBGYWN0b3J5LWxvY2FsIHRyYWl0cyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe25hbWUsIG1vZGVsQ2xhc3MsIHBhcmVudE5hbWUsIGFsaWFzZXMsIGRlY2xhcmF0aW9ucywgbG9jYWxUcmFpdHN9KSB7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmd9IC0gRmFjdG9yeSBuYW1lLiAqL1xuICAgIHRoaXMubmFtZSA9IG5hbWVcblxuICAgIC8qKiBAdHlwZSB7KG5ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pIHwgbnVsbH0gLSBNb2RlbCBjbGFzcyBvciBudWxsLiAqL1xuICAgIHRoaXMubW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gLSBQYXJlbnQgZmFjdG9yeSBuYW1lIG9yIG51bGwuICovXG4gICAgdGhpcy5wYXJlbnROYW1lID0gcGFyZW50TmFtZVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTxzdHJpbmc+fSAtIEFsaWFzIG5hbWVzLiAqL1xuICAgIHRoaXMuYWxpYXNlcyA9IC8qKiBAdHlwZSB7QXJyYXk8c3RyaW5nPn0gKi8gKE9iamVjdC5mcmVlemUoWy4uLmFsaWFzZXNdKSlcblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuRGVjbGFyYXRpb24+fSAtIE9yZGVyZWQgb3duIGRlY2xhcmF0aW9ucy4gKi9cbiAgICB0aGlzLmRlY2xhcmF0aW9ucyA9IC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuRGVjbGFyYXRpb24+fSAqLyAoT2JqZWN0LmZyZWV6ZShbLi4uZGVjbGFyYXRpb25zXSkpXG5cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHJhaXQtZGVmaW5pdGlvbi5qc1wiKS5kZWZhdWx0Pn0gLSBGYWN0b3J5LWxvY2FsIHRyYWl0cy4gKi9cbiAgICB0aGlzLmxvY2FsVHJhaXRzID0gbG9jYWxUcmFpdHNcblxuICAgIE9iamVjdC5mcmVlemUodGhpcylcbiAgfVxufVxuIl19