// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
/**
 * TableIndexArgsType type.
 * @typedef {object} TableIndexArgsType
 * @property {string} [name] - Explicit index name.
 * @property {boolean} [unique] - Whether the index should be unique.
 */
export default class TableIndex {
    /**
     * Runs constructor.
     * @param {Array<string | import("./table-column.js").default>} columns - Column names.
     * @param {TableIndexArgsType} [args] - Options object.
     */
    constructor(columns, args) {
        if (args) {
            const { name, unique, ...restArgs } = args; // eslint-disable-line no-unused-vars
            restArgsError(restArgs);
        }
        this.args = args;
        this.columns = columns;
    }
    /**
     * Runs get columns.
     * @returns {Array<string | import("./table-column.js").default>} - The columns.
     */
    getColumns() { return this.columns; }
    /**
     * Runs get name.
     * @returns {string | undefined} - The name.
     */
    getName() { return this.args?.name; }
    /**
     * Runs get unique.
     * @returns {boolean} - Whether unique.
     */
    getUnique() { return Boolean(this.args?.unique); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUtaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvdGFibGUtZGF0YS90YWJsZS1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxhQUFhLE1BQU0sZ0NBQWdDLENBQUE7QUFFMUQ7Ozs7O0dBS0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLFVBQVU7SUFDN0I7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLElBQUk7UUFDdkIsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNULE1BQU0sRUFBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLEdBQUcsUUFBUSxFQUFDLEdBQUcsSUFBSSxDQUFBLENBQUMscUNBQXFDO1lBRTlFLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN6QixDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVUsS0FBSyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUEsQ0FBQyxDQUFDO0lBRXBDOzs7T0FHRztJQUNILE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFBLENBQUMsQ0FBQztJQUVwQzs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQSxDQUFDLENBQUM7Q0FDbEQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKlxuICogVGFibGVJbmRleEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUYWJsZUluZGV4QXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbdW5pcXVlXSAtIFdoZXRoZXIgdGhlIGluZGV4IHNob3VsZCBiZSB1bmlxdWUuXG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGFibGVJbmRleCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IGltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge1RhYmxlSW5kZXhBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihjb2x1bW5zLCBhcmdzKSB7XG4gICAgaWYgKGFyZ3MpIHtcbiAgICAgIGNvbnN0IHtuYW1lLCB1bmlxdWUsIC4uLnJlc3RBcmdzfSA9IGFyZ3MgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gICAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIH1cblxuICAgIHRoaXMuYXJncyA9IGFyZ3NcbiAgICB0aGlzLmNvbHVtbnMgPSBjb2x1bW5zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1ucy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZyB8IGltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSBjb2x1bW5zLlxuICAgKi9cbiAgZ2V0Q29sdW1ucygpIHsgcmV0dXJuIHRoaXMuY29sdW1ucyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkgeyByZXR1cm4gdGhpcy5hcmdzPy5uYW1lIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdW5pcXVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHVuaXF1ZS5cbiAgICovXG4gIGdldFVuaXF1ZSgpIHsgcmV0dXJuIEJvb2xlYW4odGhpcy5hcmdzPy51bmlxdWUpIH1cbn1cbiJdfQ==