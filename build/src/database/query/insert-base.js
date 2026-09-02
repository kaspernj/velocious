// @ts-check
import restArgsError from "../../utils/rest-args-error.js";
export default class VelociousDatabaseQueryInsertBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.data] - Data payload.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {string} args.tableName - Table name.
     * @param {Array<string>} [args.columns] - Column names.
     * @param {boolean} [args.multiple] - Whether multiple.
     * @param {string[]} [args.returnLastInsertedColumnNames] - Return last inserted column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} [args.rows] - Rows to insert.
     */
    constructor({ columns, data, driver, multiple, tableName, returnLastInsertedColumnNames, rows, ...restArgs }) {
        if (!driver)
            throw new Error("No driver given to insert base");
        if (!tableName)
            throw new Error(`Invalid table name given to insert base: ${tableName}`);
        restArgsError(restArgs);
        this.columns = columns;
        this.data = data;
        this.driver = driver;
        this.multiple = multiple;
        this.returnLastInsertedColumnNames = returnLastInsertedColumnNames;
        this.rows = rows;
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
     * Runs to sql.
     * @returns {string} SQL statement
     */
    toSql() {
        const { driver } = this;
        let sql = `INSERT INTO ${driver.quoteTable(this.tableName)}`;
        let count = 0;
        let columns, lastInsertedSQL;
        if (this.returnLastInsertedColumnNames) {
            if (driver.getType() == "mssql") {
                lastInsertedSQL = ` OUTPUT `;
                for (let i = 0; i < this.returnLastInsertedColumnNames.length; i++) {
                    const columnName = this.returnLastInsertedColumnNames[i];
                    if (i > 0) {
                        lastInsertedSQL += ", ";
                    }
                    lastInsertedSQL += ` INSERTED.${driver.quoteColumn(columnName)}`;
                }
                if (this.data && Object.keys(this.data).length <= 0) {
                    sql += lastInsertedSQL;
                }
            }
            else if (driver.getType() == "mysql" || driver.getType() == "pgsql" || (driver.getType() == "sqlite" && driver.supportsInsertIntoReturning())) {
                lastInsertedSQL = " RETURNING ";
                for (let i = 0; i < this.returnLastInsertedColumnNames.length; i++) {
                    const columnName = this.returnLastInsertedColumnNames[i];
                    if (i > 0) {
                        lastInsertedSQL += ", ";
                    }
                    lastInsertedSQL += ` ${driver.quoteColumn(columnName)}`;
                }
            }
        }
        if (this.columns && this.rows) {
            columns = this.columns;
        }
        else if (this.data) {
            columns = Object.keys(this.data);
        }
        else {
            throw new Error("Neither 'column' and 'rows' or data was given");
        }
        if (columns.length > 0) {
            sql += " (";
            for (const columnName of columns) {
                if (count > 0)
                    sql += ", ";
                sql += driver.quoteColumn(columnName);
                count++;
            }
            sql += ")";
        }
        if (this.returnLastInsertedColumnNames && driver.getType() == "mssql" && this.data && Object.keys(this.data).length > 0) {
            sql += lastInsertedSQL;
        }
        if (this.columns && this.rows) {
            if (this.rows.length > 0) {
                sql += " VALUES ";
            }
            let count = 0;
            for (const row of this.rows) {
                if (count >= 1)
                    sql += ", ";
                count++;
                sql += this._valuesSql(row);
            }
        }
        else {
            if (this.data && Object.keys(this.data).length > 0) {
                sql += " VALUES ";
                sql += this._valuesSql(Object.values(this.data));
            }
            else if (driver.getType() == "sqlite" || driver.getType() == "mssql" || driver.getType() == "pgsql") {
                sql += " DEFAULT VALUES";
            }
            else if (driver.getType() == "mysql") {
                sql += " () VALUES ()";
            }
        }
        if (this.returnLastInsertedColumnNames) {
            if (driver.getType() == "pgsql" || driver.getType() == "mysql" || (driver.getType() == "sqlite" && driver.supportsInsertIntoReturning())) {
                sql += lastInsertedSQL;
            }
        }
        return sql;
    }
    /**
     * Runs values sql.
     * @param {Array<ReturnType<typeof JSON.parse>>} data - Data payload.
     * @returns {string} - SQL string.
     */
    _valuesSql(data) {
        let count = 0;
        let sql = "(";
        for (const value of data) {
            if (count > 0)
                sql += ", ";
            sql += this.formatValue(value);
            count++;
        }
        sql += ")";
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5zZXJ0LWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvaW5zZXJ0LWJhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBRTFELE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0NBQWdDO0lBQ25EOzs7Ozs7Ozs7O09BVUc7SUFDSCxZQUFZLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSw2QkFBNkIsRUFBRSxJQUFJLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDeEcsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUE7UUFDOUQsSUFBSSxDQUFDLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBRXhGLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUNoQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUN4QixJQUFJLENBQUMsNkJBQTZCLEdBQUcsNkJBQTZCLENBQUE7UUFDbEUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxXQUFXLENBQUMsS0FBSztRQUNmLElBQUksS0FBSyxLQUFLLElB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b3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlJbnNlcnRCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5kYXRhXSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kcml2ZXIgLSBEYXRhYmFzZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gW2FyZ3MuY29sdW1uc10gLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MubXVsdGlwbGVdIC0gV2hldGhlciBtdWx0aXBsZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MucmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXNdIC0gUmV0dXJuIGxhc3QgaW5zZXJ0ZWQgY29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFthcmdzLnJvd3NdIC0gUm93cyB0byBpbnNlcnQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29sdW1ucywgZGF0YSwgZHJpdmVyLCBtdWx0aXBsZSwgdGFibGVOYW1lLCByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lcywgcm93cywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgaWYgKCFkcml2ZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBnaXZlbiB0byBpbnNlcnQgYmFzZVwiKVxuICAgIGlmICghdGFibGVOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdGFibGUgbmFtZSBnaXZlbiB0byBpbnNlcnQgYmFzZTogJHt0YWJsZU5hbWV9YClcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICB0aGlzLmNvbHVtbnMgPSBjb2x1bW5zXG4gICAgdGhpcy5kYXRhID0gZGF0YVxuICAgIHRoaXMuZHJpdmVyID0gZHJpdmVyXG4gICAgdGhpcy5tdWx0aXBsZSA9IG11bHRpcGxlXG4gICAgdGhpcy5yZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lcyA9IHJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzXG4gICAgdGhpcy5yb3dzID0gcm93c1xuICAgIHRoaXMudGFibGVOYW1lID0gdGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZHJpdmVyLm9wdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ybWF0IHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIGZvcm1hdC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlcn0gLSBTUUwgbGl0ZXJhbC5cbiAgICovXG4gIGZvcm1hdFZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsKSByZXR1cm4gXCJOVUxMXCJcblxuICAgIHJldHVybiB0aGlzLmdldE9wdGlvbnMoKS5xdW90ZSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIHNxbC5cbiAgICogQHJldHVybnMge3N0cmluZ30gU1FMIHN0YXRlbWVudFxuICAgKi9cbiAgdG9TcWwoKSB7XG4gICAgY29uc3Qge2RyaXZlcn0gPSB0aGlzXG5cbiAgICBsZXQgc3FsID0gYElOU0VSVCBJTlRPICR7ZHJpdmVyLnF1b3RlVGFibGUodGhpcy50YWJsZU5hbWUpfWBcbiAgICBsZXQgY291bnQgPSAwXG4gICAgbGV0IGNvbHVtbnMsIGxhc3RJbnNlcnRlZFNRTFxuXG4gICAgaWYgKHRoaXMucmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXMpIHtcbiAgICAgIGlmIChkcml2ZXIuZ2V0VHlwZSgpID09IFwibXNzcWxcIikge1xuICAgICAgICBsYXN0SW5zZXJ0ZWRTUUwgPSBgIE9VVFBVVCBgXG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXNbaV1cblxuICAgICAgICAgIGlmIChpID4gMCkge1xuICAgICAgICAgICAgbGFzdEluc2VydGVkU1FMICs9IFwiLCBcIlxuICAgICAgICAgIH1cblxuICAgICAgICAgIGxhc3RJbnNlcnRlZFNRTCArPSBgIElOU0VSVEVELiR7ZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLmRhdGEgJiYgT2JqZWN0LmtleXModGhpcy5kYXRhKS5sZW5ndGggPD0gMCkge1xuICAgICAgICAgIHNxbCArPSBsYXN0SW5zZXJ0ZWRTUUxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChkcml2ZXIuZ2V0VHlwZSgpID09IFwibXlzcWxcIiB8fCBkcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIiB8fCAoZHJpdmVyLmdldFR5cGUoKSA9PSBcInNxbGl0ZVwiICYmIGRyaXZlci5zdXBwb3J0c0luc2VydEludG9SZXR1cm5pbmcoKSkpIHtcbiAgICAgICAgbGFzdEluc2VydGVkU1FMID0gXCIgUkVUVVJOSU5HIFwiXG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXNbaV1cblxuICAgICAgICAgIGlmIChpID4gMCkge1xuICAgICAgICAgICAgbGFzdEluc2VydGVkU1FMICs9IFwiLCBcIlxuICAgICAgICAgIH1cblxuICAgICAgICAgIGxhc3RJbnNlcnRlZFNRTCArPSBgICR7ZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbHVtbnMgJiYgdGhpcy5yb3dzKSB7XG4gICAgICBjb2x1bW5zID0gdGhpcy5jb2x1bW5zXG4gICAgfSBlbHNlIGlmICh0aGlzLmRhdGEpIHtcbiAgICAgIGNvbHVtbnMgPSBPYmplY3Qua2V5cyh0aGlzLmRhdGEpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5laXRoZXIgJ2NvbHVtbicgYW5kICdyb3dzJyBvciBkYXRhIHdhcyBnaXZlblwiKVxuICAgIH1cblxuICAgIGlmIChjb2x1bW5zLmxlbmd0aCA+IDApIHtcbiAgICAgIHNxbCArPSBcIiAoXCJcblxuICAgICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIGNvbHVtbnMpIHtcbiAgICAgICAgaWYgKGNvdW50ID4gMCkgc3FsICs9IFwiLCBcIlxuXG4gICAgICAgIHNxbCArPSBkcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSlcbiAgICAgICAgY291bnQrK1xuICAgICAgfVxuXG4gICAgICBzcWwgKz0gXCIpXCJcbiAgICB9XG5cbiAgICBpZiAodGhpcy5yZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lcyAmJiBkcml2ZXIuZ2V0VHlwZSgpID09IFwibXNzcWxcIiAmJiB0aGlzLmRhdGEgJiYgT2JqZWN0LmtleXModGhpcy5kYXRhKS5sZW5ndGggPiAwKSB7XG4gICAgICBzcWwgKz0gbGFzdEluc2VydGVkU1FMXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29sdW1ucyAmJiB0aGlzLnJvd3MpIHtcbiAgICAgIGlmICh0aGlzLnJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBzcWwgKz0gXCIgVkFMVUVTIFwiXG4gICAgICB9XG5cbiAgICAgIGxldCBjb3VudCA9IDBcblxuICAgICAgZm9yIChjb25zdCByb3cgb2YgdGhpcy5yb3dzKSB7XG4gICAgICAgIGlmIChjb3VudCA+PSAxKSBzcWwgKz0gXCIsIFwiXG5cbiAgICAgICAgY291bnQrK1xuICAgICAgICBzcWwgKz0gdGhpcy5fdmFsdWVzU3FsKHJvdylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuZGF0YSAmJiBPYmplY3Qua2V5cyh0aGlzLmRhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3FsICs9IFwiIFZBTFVFUyBcIlxuICAgICAgICBzcWwgKz0gdGhpcy5fdmFsdWVzU3FsKE9iamVjdC52YWx1ZXModGhpcy5kYXRhKSlcbiAgICAgIH0gZWxzZSBpZiAoZHJpdmVyLmdldFR5cGUoKSA9PSBcInNxbGl0ZVwiIHx8IGRyaXZlci5nZXRUeXBlKCkgPT0gXCJtc3NxbFwiIHx8IGRyaXZlci5nZXRUeXBlKCkgPT0gXCJwZ3NxbFwiKSB7XG4gICAgICAgIHNxbCArPSBcIiBERUZBVUxUIFZBTFVFU1wiXG4gICAgICB9IGVsc2UgaWYgKGRyaXZlci5nZXRUeXBlKCkgPT0gXCJteXNxbFwiKSB7XG4gICAgICAgIHNxbCArPSBcIiAoKSBWQUxVRVMgKClcIlxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLnJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzKSB7XG4gICAgICBpZiAoZHJpdmVyLmdldFR5cGUoKSA9PSBcInBnc3FsXCIgfHwgZHJpdmVyLmdldFR5cGUoKSA9PSBcIm15c3FsXCIgfHwgKGRyaXZlci5nZXRUeXBlKCkgPT0gXCJzcWxpdGVcIiAmJiBkcml2ZXIuc3VwcG9ydHNJbnNlcnRJbnRvUmV0dXJuaW5nKCkpKSB7XG4gICAgICAgIHNxbCArPSBsYXN0SW5zZXJ0ZWRTUUxcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWx1ZXMgc3FsLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgX3ZhbHVlc1NxbChkYXRhKSB7XG4gICAgbGV0IGNvdW50ID0gMFxuICAgIGxldCBzcWwgPSBcIihcIlxuXG4gICAgZm9yIChjb25zdCB2YWx1ZSBvZiBkYXRhKSB7XG4gICAgICBpZiAoY291bnQgPiAwKSBzcWwgKz0gXCIsIFwiXG5cbiAgICAgIHNxbCArPSB0aGlzLmZvcm1hdFZhbHVlKHZhbHVlKVxuICAgICAgY291bnQrK1xuICAgIH1cblxuICAgIHNxbCArPSBcIilcIlxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG59XG4iXX0=