// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryUpsertBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Array<string>} args.conflictColumns - Columns that identify duplicates.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.data - Data payload.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {Array<string>} args.updateColumns - Columns to update on conflict.
     * @param {string} args.tableName - Table name.
     */
    constructor({ conflictColumns, data, driver, tableName, updateColumns, ...restArgs }) {
        if (!driver)
            throw new Error("No driver given to upsert base");
        if (!tableName)
            throw new Error(`Invalid table name given to upsert base: ${tableName}`);
        if (!conflictColumns?.length)
            throw new Error("No conflictColumns given to upsert base");
        if (!updateColumns?.length)
            throw new Error("No updateColumns given to upsert base");
        if (!data || Object.keys(data).length <= 0)
            throw new Error("No data given to upsert base");
        restArgsError(restArgs);
        this.conflictColumns = conflictColumns;
        this.data = data;
        this.driver = driver;
        this.tableName = tableName;
        this.updateColumns = updateColumns;
    }
    /**
     * Runs data columns.
     * @returns {Array<string>} - Column names from the data payload.
     */
    dataColumns() {
        return Object.keys(this.data);
    }
    /**
     * Runs format column value.
     * @param {string} columnName - Column name.
     * @returns {string | number} - SQL literal.
     */
    formatColumnValue(columnName) {
        return this.formatValue(this.data[columnName]);
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
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - Driver options.
     */
    getOptions() {
        return this.driver.options();
    }
    /**
     * Runs quoted column.
     * @param {string} columnName - Column name.
     * @returns {string} - Quoted column name.
     */
    quotedColumn(columnName) {
        return this.getOptions().quoteColumnName(columnName);
    }
    /**
     * Runs quoted insert columns sql.
     * @returns {string} - Comma-separated quoted insert columns.
     */
    quotedInsertColumnsSql() {
        return this.dataColumns().map((columnName) => this.quotedColumn(columnName)).join(", ");
    }
    /**
     * Runs quoted insert values sql.
     * @returns {string} - Comma-separated formatted insert values.
     */
    quotedInsertValuesSql() {
        return this.dataColumns().map((columnName) => this.formatColumnValue(columnName)).join(", ");
    }
    /**
     * Runs quoted table name.
     * @returns {string} - Quoted table name.
     */
    quotedTableName() {
        return this.driver.quoteTable(this.tableName);
    }
    toSql() {
        throw new Error("'toSql' wasn't implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXBzZXJ0LWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvdXBzZXJ0LWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBRTFELE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWdDO0lBQ25EOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxFQUFDLGVBQWUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxhQUFhLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDaEYsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUE7UUFDOUQsSUFBSSxDQUFDLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBQ3hGLElBQUksQ0FBQyxlQUFlLEVBQUUsTUFBTTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLENBQUMsQ0FBQTtRQUN4RixJQUFJLENBQUMsYUFBYSxFQUFFLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7UUFDcEYsSUFBSSxDQUFDLElBQUksSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFBO1FBRTNGLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsZUFBZSxHQUFHLGVBQWUsQ0FBQTtRQUN0QyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtRQUMxQixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsV0FBVztRQUNULE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDL0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQkFBaUIsQ0FBQyxVQUFVO1FBQzFCLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxXQUFXLENBQUMsS0FBSztRQUNmLElBQUksS0FBSyxLQUFLLElBQUk7WUFBRSxPQUFPLE1BQU0sQ0FBQTtRQUVqQyxPQUFPLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsVUFBVTtRQUNyQixPQUFPLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDdEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILHNCQUFzQjtRQUNwQixPQUFPLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDekYsQ0FBQztJQUVEOzs7T0FHRztJQUNILHFCQUFxQjtRQUNuQixPQUFPLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUM5RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRCxLQUFLO1FBQ0gsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVVwc2VydEJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLmNvbmZsaWN0Q29sdW1ucyAtIENvbHVtbnMgdGhhdCBpZGVudGlmeSBkdXBsaWNhdGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5kYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLnVwZGF0ZUNvbHVtbnMgLSBDb2x1bW5zIHRvIHVwZGF0ZSBvbiBjb25mbGljdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25mbGljdENvbHVtbnMsIGRhdGEsIGRyaXZlciwgdGFibGVOYW1lLCB1cGRhdGVDb2x1bW5zLCAuLi5yZXN0QXJnc30pIHtcbiAgICBpZiAoIWRyaXZlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gZHJpdmVyIGdpdmVuIHRvIHVwc2VydCBiYXNlXCIpXG4gICAgaWYgKCF0YWJsZU5hbWUpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0YWJsZSBuYW1lIGdpdmVuIHRvIHVwc2VydCBiYXNlOiAke3RhYmxlTmFtZX1gKVxuICAgIGlmICghY29uZmxpY3RDb2x1bW5zPy5sZW5ndGgpIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZsaWN0Q29sdW1ucyBnaXZlbiB0byB1cHNlcnQgYmFzZVwiKVxuICAgIGlmICghdXBkYXRlQ29sdW1ucz8ubGVuZ3RoKSB0aHJvdyBuZXcgRXJyb3IoXCJObyB1cGRhdGVDb2x1bW5zIGdpdmVuIHRvIHVwc2VydCBiYXNlXCIpXG4gICAgaWYgKCFkYXRhIHx8IE9iamVjdC5rZXlzKGRhdGEpLmxlbmd0aCA8PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIGdpdmVuIHRvIHVwc2VydCBiYXNlXCIpXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5jb25mbGljdENvbHVtbnMgPSBjb25mbGljdENvbHVtbnNcbiAgICB0aGlzLmRhdGEgPSBkYXRhXG4gICAgdGhpcy5kcml2ZXIgPSBkcml2ZXJcbiAgICB0aGlzLnRhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICAgIHRoaXMudXBkYXRlQ29sdW1ucyA9IHVwZGF0ZUNvbHVtbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRhdGEgY29sdW1ucy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gQ29sdW1uIG5hbWVzIGZyb20gdGhlIGRhdGEgcGF5bG9hZC5cbiAgICovXG4gIGRhdGFDb2x1bW5zKCkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmRhdGEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JtYXQgY29sdW1uIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyfSAtIFNRTCBsaXRlcmFsLlxuICAgKi9cbiAgZm9ybWF0Q29sdW1uVmFsdWUoY29sdW1uTmFtZSkge1xuICAgIHJldHVybiB0aGlzLmZvcm1hdFZhbHVlKHRoaXMuZGF0YVtjb2x1bW5OYW1lXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcm1hdCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byBmb3JtYXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gU1FMIGxpdGVyYWwuXG4gICAqL1xuICBmb3JtYXRWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIFwiTlVMTFwiXG5cbiAgICByZXR1cm4gdGhpcy5nZXRPcHRpb25zKCkucXVvdGUodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gRHJpdmVyIG9wdGlvbnMuXG4gICAqL1xuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLmRyaXZlci5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlZCBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVvdGVkIGNvbHVtbiBuYW1lLlxuICAgKi9cbiAgcXVvdGVkQ29sdW1uKGNvbHVtbk5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRPcHRpb25zKCkucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZWQgaW5zZXJ0IGNvbHVtbnMgc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbW1hLXNlcGFyYXRlZCBxdW90ZWQgaW5zZXJ0IGNvbHVtbnMuXG4gICAqL1xuICBxdW90ZWRJbnNlcnRDb2x1bW5zU3FsKCkge1xuICAgIHJldHVybiB0aGlzLmRhdGFDb2x1bW5zKCkubWFwKChjb2x1bW5OYW1lKSA9PiB0aGlzLnF1b3RlZENvbHVtbihjb2x1bW5OYW1lKSkuam9pbihcIiwgXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZWQgaW5zZXJ0IHZhbHVlcyBzcWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ29tbWEtc2VwYXJhdGVkIGZvcm1hdHRlZCBpbnNlcnQgdmFsdWVzLlxuICAgKi9cbiAgcXVvdGVkSW5zZXJ0VmFsdWVzU3FsKCkge1xuICAgIHJldHVybiB0aGlzLmRhdGFDb2x1bW5zKCkubWFwKChjb2x1bW5OYW1lKSA9PiB0aGlzLmZvcm1hdENvbHVtblZhbHVlKGNvbHVtbk5hbWUpKS5qb2luKFwiLCBcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlZCB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1b3RlZCB0YWJsZSBuYW1lLlxuICAgKi9cbiAgcXVvdGVkVGFibGVOYW1lKCkge1xuICAgIHJldHVybiB0aGlzLmRyaXZlci5xdW90ZVRhYmxlKHRoaXMudGFibGVOYW1lKVxuICB9XG5cbiAgdG9TcWwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RvU3FsJyB3YXNuJ3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19