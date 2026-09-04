// @ts-check
export default class VelociousDatabaseQueryUpdateBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.conditions - Conditions.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.data - Data payload.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {string} args.tableName - Table name.
     */
    constructor({ conditions, data, driver, tableName }) {
        this.conditions = conditions;
        this.data = data;
        this.driver = driver;
        this.tableName = tableName;
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.driver.options();
    }
    /**
     * Runs format value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to format.
     * @returns {string | number} - SQL literal.
     */
    formatValue(value) {
        if (value === null)
            return "NULL";
        return this.getOptions().quote(value);
    }
    /**
     * Formats one hash condition with SQL null semantics.
     * @param {string} columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} value - Condition value.
     * @returns {string} - SQL condition.
     */
    formatCondition(columnName, value) {
        const column = this.getOptions().quoteColumnName(columnName);
        if (value === null)
            return `${column} IS NULL`;
        return `${column} = ${this.formatValue(value)}`;
    }
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXBkYXRlLWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvdXBkYXRlLWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWdDO0lBQ25EOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDO1FBQy9DLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO1FBQ3BCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO0lBQzVCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsV0FBVyxDQUFDLEtBQUs7UUFDZixJQUFJLEtBQUssS0FBSyxJQUFJO1lBQUUsT0FBTyxNQUFNLENBQUE7UUFFakMsT0FBTyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3ZDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGVBQWUsQ0FBQyxVQUFVLEVBQUUsS0FBSztRQUMvQixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTVELElBQUksS0FBSyxLQUFLLElBQUk7WUFBRSxPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7UUFFOUMsT0FBTyxHQUFHLE1BQU0sTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUE7SUFDakQsQ0FBQztJQUVELEtBQUs7UUFDSCxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUE7SUFDL0MsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlVcGRhdGVCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5kYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25kaXRpb25zLCBkYXRhLCBkcml2ZXIsIHRhYmxlTmFtZX0pIHtcbiAgICB0aGlzLmNvbmRpdGlvbnMgPSBjb25kaXRpb25zXG4gICAgdGhpcy5kYXRhID0gZGF0YVxuICAgIHRoaXMuZHJpdmVyID0gZHJpdmVyXG4gICAgdGhpcy50YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5kcml2ZXIub3B0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtYXQgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gZm9ybWF0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyfSAtIFNRTCBsaXRlcmFsLlxuICAgKi9cbiAgZm9ybWF0VmFsdWUodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBcIk5VTExcIlxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0T3B0aW9ucygpLnF1b3RlKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcm1hdHMgb25lIGhhc2ggY29uZGl0aW9uIHdpdGggU1FMIG51bGwgc2VtYW50aWNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmRpdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgY29uZGl0aW9uLlxuICAgKi9cbiAgZm9ybWF0Q29uZGl0aW9uKGNvbHVtbk5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgY29sdW1uID0gdGhpcy5nZXRPcHRpb25zKCkucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAodmFsdWUgPT09IG51bGwpIHJldHVybiBgJHtjb2x1bW59IElTIE5VTExgXG5cbiAgICByZXR1cm4gYCR7Y29sdW1ufSA9ICR7dGhpcy5mb3JtYXRWYWx1ZSh2YWx1ZSl9YFxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU3FsJyB3YXNuJ3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19