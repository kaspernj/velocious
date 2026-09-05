// @ts-check
import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain) {
        super();
        this.plain = plain;
        const aliasMatch = plain.match(/\sAS\s+([^\s]+)\s*$/iu);
        this.alias = aliasMatch
            ? aliasMatch[1].replace(/^["[`]|["`\]]$/gu, "")
            : undefined;
    }
    /**
     * Returns the explicit terminal AS alias parsed at the raw-select boundary.
     * @returns {string | undefined} - Explicit terminal AS alias, or undefined when absent.
     */
    getAlias() { return this.alias; }
    toSql() {
        return this.plain;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0LXBsYWluLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3F1ZXJ5L3NlbGVjdC1wbGFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFFekMsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQ0FBa0MsU0FBUSxVQUFVO0lBQ3ZFOzs7T0FHRztJQUNILFlBQVksS0FBSztRQUNmLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFFbEIsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1FBRXZELElBQUksQ0FBQyxLQUFLLEdBQUcsVUFBVTtZQUNyQixDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUM7WUFDL0MsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtJQUNmLENBQUM7SUFFRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBLENBQUMsQ0FBQztJQUVoQyxLQUFLO1FBQ0gsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgU2VsZWN0QmFzZSBmcm9tIFwiLi9zZWxlY3QtYmFzZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlTZWxlY3RQbGFpbiBleHRlbmRzIFNlbGVjdEJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBsYWluIC0gUGxhaW4uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihwbGFpbikge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLnBsYWluID0gcGxhaW5cblxuICAgIGNvbnN0IGFsaWFzTWF0Y2ggPSBwbGFpbi5tYXRjaCgvXFxzQVNcXHMrKFteXFxzXSspXFxzKiQvaXUpXG5cbiAgICB0aGlzLmFsaWFzID0gYWxpYXNNYXRjaFxuICAgICAgPyBhbGlhc01hdGNoWzFdLnJlcGxhY2UoL15bXCJbYF18W1wiYFxcXV0kL2d1LCBcIlwiKVxuICAgICAgOiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBleHBsaWNpdCB0ZXJtaW5hbCBBUyBhbGlhcyBwYXJzZWQgYXQgdGhlIHJhdy1zZWxlY3QgYm91bmRhcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRXhwbGljaXQgdGVybWluYWwgQVMgYWxpYXMsIG9yIHVuZGVmaW5lZCB3aGVuIGFic2VudC5cbiAgICovXG4gIGdldEFsaWFzKCkgeyByZXR1cm4gdGhpcy5hbGlhcyB9XG5cbiAgdG9TcWwoKSB7XG4gICAgcmV0dXJuIHRoaXMucGxhaW5cbiAgfVxufVxuIl19