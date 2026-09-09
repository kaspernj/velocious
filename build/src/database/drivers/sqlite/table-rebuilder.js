// @ts-check
import CreateIndexBase from "../../query/create-index-base.js";
import restArgsError from "../../../utils/rest-args-error.js";
import TableData from "../../table-data/index.js";
/**
 * Emits the SQL sequence for SQLite's "rebuild" approach to schema changes.
 *
 * SQLite cannot add/drop foreign-key constraints, drop columns on older
 * versions, change column types, or add CHECK constraints via ALTER TABLE.
 * The standard workaround (https://sqlite.org/lang_altertable.html) is to
 * create a new table with the desired schema, copy rows over, drop the
 * original, and rename the replacement.
 *
 * Caller passes the desired final schema; this class handles the mechanical
 * sequence (CREATE temp / INSERT...SELECT / DROP / RENAME / recreate
 * indexes). Caller is responsible for any FK toggling or transaction setup
 * around the returned SQL — `PRAGMA foreign_keys` is connection-scoped and
 * cannot be flipped inside a transaction, so wrapping policy is left to the
 * caller (see `sql/alter-table.js`).
 */
export default class VelociousDatabaseDriversSqliteTableRebuilder {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     * @param {string} args.originalTableName - Name of the existing table to rebuild.
     * @param {TableData} args.targetTableData - Desired final schema (columns + foreign keys + indexes). The instance's name is overwritten internally during emission.
     * @param {Array<[string, string]>} args.columnPairs - Pairs of [oldColumnName, newColumnName] describing how rows from the original table should populate the rebuilt table.
     */
    constructor({ driver, originalTableName, targetTableData, columnPairs, ...restArgs }) {
        restArgsError(restArgs);
        if (!(targetTableData instanceof TableData))
            throw new Error("Invalid target table data was given");
        this.driver = driver;
        this.originalTableName = originalTableName;
        this.targetTableData = targetTableData;
        this.columnPairs = columnPairs;
    }
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements to execute in order.
     */
    async toSQLs() {
        const driver = this.driver;
        const options = driver.options();
        const originalTableName = this.originalTableName;
        const tempTableName = `${originalTableName}_velocious_rebuild`;
        const targetTableData = this.targetTableData;
        const previousTargetName = targetTableData.getName();
        // Column-level `index: true` indexes are named after the table they are created with, and
        // ALTER TABLE ... RENAME does not rename indexes - creating them inside the temp table's
        // CREATE would leak the temp rebuild name permanently. Strip the flags for the temp CREATE
        // and create those indexes explicitly on the temp table with their FINAL names BEFORE the
        // copy: index names are database-global and survive the rename, and a violation (e.g. a new
        // unique index over rows that all receive the same default) fails during INSERT...SELECT,
        // while the original table still exists - never after the swap.
        /** @type {Array<{column: import("../../table-data/table-column.js").default, index: ReturnType<typeof JSON.parse>, indexArgs: ReturnType<typeof JSON.parse>}>} */
        const strippedColumnIndexes = [];
        for (const column of targetTableData.getColumns()) {
            if (!column.getIndex())
                continue;
            strippedColumnIndexes.push({ column, index: column.getIndex(), indexArgs: column.getIndexArgs() });
            column.setIndex(false);
        }
        targetTableData.setName(tempTableName);
        let createTableSQLs;
        try {
            createTableSQLs = await driver.createTableSql(targetTableData);
        }
        finally {
            targetTableData.setName(previousTargetName);
            for (const { column, index } of strippedColumnIndexes)
                column.setIndex(index);
        }
        const newColumnsSQL = this.columnPairs.map(([, newName]) => options.quoteColumnName(newName)).join(", ");
        const oldColumnsSQL = this.columnPairs.map(([oldName]) => options.quoteColumnName(oldName)).join(", ");
        const sqls = [];
        for (const sql of createTableSQLs)
            sqls.push(sql);
        for (const { column, indexArgs } of strippedColumnIndexes) {
            const { unique, ...restIndexArgs } = indexArgs || {};
            restArgsError(restIndexArgs);
            const createIndexSQLs = await new CreateIndexBase({
                columns: [column.getName()],
                driver,
                name: `index_on_${originalTableName}_${column.getName()}`,
                tableName: tempTableName,
                unique
            }).toSQLs();
            for (const sql of createIndexSQLs)
                sqls.push(sql);
        }
        if (this.columnPairs.length > 0) {
            sqls.push(`INSERT INTO ${options.quoteTableName(tempTableName)} (${newColumnsSQL}) ` +
                `SELECT ${oldColumnsSQL} FROM ${options.quoteTableName(originalTableName)}`);
        }
        sqls.push(`DROP TABLE ${options.quoteTableName(originalTableName)}`);
        sqls.push(`ALTER TABLE ${options.quoteTableName(tempTableName)} RENAME TO ${options.quoteTableName(originalTableName)}`);
        for (const tableDataIndex of targetTableData.getIndexes()) {
            const createIndexSQLs = await new CreateIndexBase({
                columns: tableDataIndex.getColumns(),
                driver,
                name: tableDataIndex.getName(),
                tableName: originalTableName,
                unique: tableDataIndex.getUnique()
            }).toSQLs();
            for (const sql of createIndexSQLs)
                sqls.push(sql);
        }
        return sqls;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUtcmVidWlsZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL3RhYmxlLXJlYnVpbGRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxlQUFlLE1BQU0sa0NBQWtDLENBQUE7QUFDOUQsT0FBTyxhQUFhLE1BQU0sbUNBQW1DLENBQUE7QUFDN0QsT0FBTyxTQUFTLE1BQU0sMkJBQTJCLENBQUE7QUFFakQ7Ozs7Ozs7Ozs7Ozs7OztHQWVHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyw0Q0FBNEM7SUFDL0Q7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsZUFBZSxFQUFFLFdBQVcsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUNoRixhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLENBQUMsZUFBZSxZQUFZLFNBQVMsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUVuRyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsaUJBQWlCLENBQUE7UUFDMUMsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUE7UUFDdEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQTtRQUMxQixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDaEMsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUE7UUFDaEQsTUFBTSxhQUFhLEdBQUcsR0FBRyxpQkFBaUIsb0JBQW9CLENBQUE7UUFDOUQsTUFB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QUMxRSxVQUFVLGFBQWEsU0FBUyxPQUFPLENBQUMsY0FBYyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FDNUUsQ0FBQTtRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNwRSxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsT0FBTyxDQUFDLGNBQWMsQ0FBQyxhQUFhLENBQUMsY0FBYyxPQUFPLENBQUMsY0FBYyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBRXhILEtBQUssTUFBTSxjQUFjLElBQUksZUFBZSxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUM7WUFDMUQsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLGVBQWUsQ0FBQztnQkFDaEQsT0FBTyxFQUFFLGNBQWMsQ0FBQyxVQUFVLEVBQUU7Z0JBQ3BDLE1BQU07Z0JBQ04sSUFBSSxFQUFFLGNBQWMsQ0FBQyxPQUFPLEVBQUU7Z0JBQzlCLFNBQVMsRUFBRSxpQkFBaUI7Z0JBQzVCLE1BQU0sRUFBRSxjQUFjLENBQUMsU0FBUyxFQUFFO2FBQ25DLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQTtZQUVYLEtBQUssTUFBTSxHQUFHLElBQUksZUFBZTtnQkFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ25ELENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ3JlYXRlSW5kZXhCYXNlIGZyb20gXCIuLi8uLi9xdWVyeS9jcmVhdGUtaW5kZXgtYmFzZS5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuXG4vKipcbiAqIEVtaXRzIHRoZSBTUUwgc2VxdWVuY2UgZm9yIFNRTGl0ZSdzIFwicmVidWlsZFwiIGFwcHJvYWNoIHRvIHNjaGVtYSBjaGFuZ2VzLlxuICpcbiAqIFNRTGl0ZSBjYW5ub3QgYWRkL2Ryb3AgZm9yZWlnbi1rZXkgY29uc3RyYWludHMsIGRyb3AgY29sdW1ucyBvbiBvbGRlclxuICogdmVyc2lvbnMsIGNoYW5nZSBjb2x1bW4gdHlwZXMsIG9yIGFkZCBDSEVDSyBjb25zdHJhaW50cyB2aWEgQUxURVIgVEFCTEUuXG4gKiBUaGUgc3RhbmRhcmQgd29ya2Fyb3VuZCAoaHR0cHM6Ly9zcWxpdGUub3JnL2xhbmdfYWx0ZXJ0YWJsZS5odG1sKSBpcyB0b1xuICogY3JlYXRlIGEgbmV3IHRhYmxlIHdpdGggdGhlIGRlc2lyZWQgc2NoZW1hLCBjb3B5IHJvd3Mgb3ZlciwgZHJvcCB0aGVcbiAqIG9yaWdpbmFsLCBhbmQgcmVuYW1lIHRoZSByZXBsYWNlbWVudC5cbiAqXG4gKiBDYWxsZXIgcGFzc2VzIHRoZSBkZXNpcmVkIGZpbmFsIHNjaGVtYTsgdGhpcyBjbGFzcyBoYW5kbGVzIHRoZSBtZWNoYW5pY2FsXG4gKiBzZXF1ZW5jZSAoQ1JFQVRFIHRlbXAgLyBJTlNFUlQuLi5TRUxFQ1QgLyBEUk9QIC8gUkVOQU1FIC8gcmVjcmVhdGVcbiAqIGluZGV4ZXMpLiBDYWxsZXIgaXMgcmVzcG9uc2libGUgZm9yIGFueSBGSyB0b2dnbGluZyBvciB0cmFuc2FjdGlvbiBzZXR1cFxuICogYXJvdW5kIHRoZSByZXR1cm5lZCBTUUwg4oCUIGBQUkFHTUEgZm9yZWlnbl9rZXlzYCBpcyBjb25uZWN0aW9uLXNjb3BlZCBhbmRcbiAqIGNhbm5vdCBiZSBmbGlwcGVkIGluc2lkZSBhIHRyYW5zYWN0aW9uLCBzbyB3cmFwcGluZyBwb2xpY3kgaXMgbGVmdCB0byB0aGVcbiAqIGNhbGxlciAoc2VlIGBzcWwvYWx0ZXItdGFibGUuanNgKS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlVGFibGVSZWJ1aWxkZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5vcmlnaW5hbFRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIGV4aXN0aW5nIHRhYmxlIHRvIHJlYnVpbGQuXG4gICAqIEBwYXJhbSB7VGFibGVEYXRhfSBhcmdzLnRhcmdldFRhYmxlRGF0YSAtIERlc2lyZWQgZmluYWwgc2NoZW1hIChjb2x1bW5zICsgZm9yZWlnbiBrZXlzICsgaW5kZXhlcykuIFRoZSBpbnN0YW5jZSdzIG5hbWUgaXMgb3ZlcndyaXR0ZW4gaW50ZXJuYWxseSBkdXJpbmcgZW1pc3Npb24uXG4gICAqIEBwYXJhbSB7QXJyYXk8W3N0cmluZywgc3RyaW5nXT59IGFyZ3MuY29sdW1uUGFpcnMgLSBQYWlycyBvZiBbb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZV0gZGVzY3JpYmluZyBob3cgcm93cyBmcm9tIHRoZSBvcmlnaW5hbCB0YWJsZSBzaG91bGQgcG9wdWxhdGUgdGhlIHJlYnVpbHQgdGFibGUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZHJpdmVyLCBvcmlnaW5hbFRhYmxlTmFtZSwgdGFyZ2V0VGFibGVEYXRhLCBjb2x1bW5QYWlycywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghKHRhcmdldFRhYmxlRGF0YSBpbnN0YW5jZW9mIFRhYmxlRGF0YSkpIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgdGFyZ2V0IHRhYmxlIGRhdGEgd2FzIGdpdmVuXCIpXG5cbiAgICB0aGlzLmRyaXZlciA9IGRyaXZlclxuICAgIHRoaXMub3JpZ2luYWxUYWJsZU5hbWUgPSBvcmlnaW5hbFRhYmxlTmFtZVxuICAgIHRoaXMudGFyZ2V0VGFibGVEYXRhID0gdGFyZ2V0VGFibGVEYXRhXG4gICAgdGhpcy5jb2x1bW5QYWlycyA9IGNvbHVtblBhaXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cyB0byBleGVjdXRlIGluIG9yZGVyLlxuICAgKi9cbiAgYXN5bmMgdG9TUUxzKCkge1xuICAgIGNvbnN0IGRyaXZlciA9IHRoaXMuZHJpdmVyXG4gICAgY29uc3Qgb3B0aW9ucyA9IGRyaXZlci5vcHRpb25zKClcbiAgICBjb25zdCBvcmlnaW5hbFRhYmxlTmFtZSA9IHRoaXMub3JpZ2luYWxUYWJsZU5hbWVcbiAgICBjb25zdCB0ZW1wVGFibGVOYW1lID0gYCR7b3JpZ2luYWxUYWJsZU5hbWV9X3ZlbG9jaW91c19yZWJ1aWxkYFxuICAgIGNvbnN0IHRhcmdldFRhYmxlRGF0YSA9IHRoaXMudGFyZ2V0VGFibGVEYXRhXG4gICAgY29uc3QgcHJldmlvdXNUYXJnZXROYW1lID0gdGFyZ2V0VGFibGVEYXRhLmdldE5hbWUoKVxuXG4gICAgLy8gQ29sdW1uLWxldmVsIGBpbmRleDogdHJ1ZWAgaW5kZXhlcyBhcmUgbmFtZWQgYWZ0ZXIgdGhlIHRhYmxlIHRoZXkgYXJlIGNyZWF0ZWQgd2l0aCwgYW5kXG4gICAgLy8gQUxURVIgVEFCTEUgLi4uIFJFTkFNRSBkb2VzIG5vdCByZW5hbWUgaW5kZXhlcyAtIGNyZWF0aW5nIHRoZW0gaW5zaWRlIHRoZSB0ZW1wIHRhYmxlJ3NcbiAgICAvLyBDUkVBVEUgd291bGQgbGVhayB0aGUgdGVtcCByZWJ1aWxkIG5hbWUgcGVybWFuZW50bHkuIFN0cmlwIHRoZSBmbGFncyBmb3IgdGhlIHRlbXAgQ1JFQVRFXG4gICAgLy8gYW5kIGNyZWF0ZSB0aG9zZSBpbmRleGVzIGV4cGxpY2l0bHkgb24gdGhlIHRlbXAgdGFibGUgd2l0aCB0aGVpciBGSU5BTCBuYW1lcyBCRUZPUkUgdGhlXG4gICAgLy8gY29weTogaW5kZXggbmFtZXMgYXJlIGRhdGFiYXNlLWdsb2JhbCBhbmQgc3Vydml2ZSB0aGUgcmVuYW1lLCBhbmQgYSB2aW9sYXRpb24gKGUuZy4gYSBuZXdcbiAgICAvLyB1bmlxdWUgaW5kZXggb3ZlciByb3dzIHRoYXQgYWxsIHJlY2VpdmUgdGhlIHNhbWUgZGVmYXVsdCkgZmFpbHMgZHVyaW5nIElOU0VSVC4uLlNFTEVDVCxcbiAgICAvLyB3aGlsZSB0aGUgb3JpZ2luYWwgdGFibGUgc3RpbGwgZXhpc3RzIC0gbmV2ZXIgYWZ0ZXIgdGhlIHN3YXAuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7Y29sdW1uOiBpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0LCBpbmRleDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGluZGV4QXJnczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gKi9cbiAgICBjb25zdCBzdHJpcHBlZENvbHVtbkluZGV4ZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGFyZ2V0VGFibGVEYXRhLmdldENvbHVtbnMoKSkge1xuICAgICAgaWYgKCFjb2x1bW4uZ2V0SW5kZXgoKSkgY29udGludWVcblxuICAgICAgc3RyaXBwZWRDb2x1bW5JbmRleGVzLnB1c2goe2NvbHVtbiwgaW5kZXg6IGNvbHVtbi5nZXRJbmRleCgpLCBpbmRleEFyZ3M6IGNvbHVtbi5nZXRJbmRleEFyZ3MoKX0pXG4gICAgICBjb2x1bW4uc2V0SW5kZXgoZmFsc2UpXG4gICAgfVxuXG4gICAgdGFyZ2V0VGFibGVEYXRhLnNldE5hbWUodGVtcFRhYmxlTmFtZSlcblxuICAgIGxldCBjcmVhdGVUYWJsZVNRTHNcblxuICAgIHRyeSB7XG4gICAgICBjcmVhdGVUYWJsZVNRTHMgPSBhd2FpdCBkcml2ZXIuY3JlYXRlVGFibGVTcWwodGFyZ2V0VGFibGVEYXRhKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0YXJnZXRUYWJsZURhdGEuc2V0TmFtZShwcmV2aW91c1RhcmdldE5hbWUpXG5cbiAgICAgIGZvciAoY29uc3Qge2NvbHVtbiwgaW5kZXh9IG9mIHN0cmlwcGVkQ29sdW1uSW5kZXhlcykgY29sdW1uLnNldEluZGV4KGluZGV4KVxuICAgIH1cblxuICAgIGNvbnN0IG5ld0NvbHVtbnNTUUwgPSB0aGlzLmNvbHVtblBhaXJzLm1hcCgoWywgbmV3TmFtZV0pID0+IG9wdGlvbnMucXVvdGVDb2x1bW5OYW1lKG5ld05hbWUpKS5qb2luKFwiLCBcIilcbiAgICBjb25zdCBvbGRDb2x1bW5zU1FMID0gdGhpcy5jb2x1bW5QYWlycy5tYXAoKFtvbGROYW1lXSkgPT4gb3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUob2xkTmFtZSkpLmpvaW4oXCIsIFwiKVxuXG4gICAgY29uc3Qgc3FscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBjcmVhdGVUYWJsZVNRTHMpIHNxbHMucHVzaChzcWwpXG5cbiAgICBmb3IgKGNvbnN0IHtjb2x1bW4sIGluZGV4QXJnc30gb2Ygc3RyaXBwZWRDb2x1bW5JbmRleGVzKSB7XG4gICAgICBjb25zdCB7dW5pcXVlLCAuLi5yZXN0SW5kZXhBcmdzfSA9IGluZGV4QXJncyB8fCB7fVxuXG4gICAgICByZXN0QXJnc0Vycm9yKHJlc3RJbmRleEFyZ3MpXG5cbiAgICAgIGNvbnN0IGNyZWF0ZUluZGV4U1FMcyA9IGF3YWl0IG5ldyBDcmVhdGVJbmRleEJhc2Uoe1xuICAgICAgICBjb2x1bW5zOiBbY29sdW1uLmdldE5hbWUoKV0sXG4gICAgICAgIGRyaXZlcixcbiAgICAgICAgbmFtZTogYGluZGV4X29uXyR7b3JpZ2luYWxUYWJsZU5hbWV9XyR7Y29sdW1uLmdldE5hbWUoKX1gLFxuICAgICAgICB0YWJsZU5hbWU6IHRlbXBUYWJsZU5hbWUsXG4gICAgICAgIHVuaXF1ZVxuICAgICAgfSkudG9TUUxzKClcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2YgY3JlYXRlSW5kZXhTUUxzKSBzcWxzLnB1c2goc3FsKVxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbHVtblBhaXJzLmxlbmd0aCA+IDApIHtcbiAgICAgIHNxbHMucHVzaChcbiAgICAgICAgYElOU0VSVCBJTlRPICR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0ZW1wVGFibGVOYW1lKX0gKCR7bmV3Q29sdW1uc1NRTH0pIGAgK1xuICAgICAgICBgU0VMRUNUICR7b2xkQ29sdW1uc1NRTH0gRlJPTSAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUob3JpZ2luYWxUYWJsZU5hbWUpfWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBzcWxzLnB1c2goYERST1AgVEFCTEUgJHtvcHRpb25zLnF1b3RlVGFibGVOYW1lKG9yaWdpbmFsVGFibGVOYW1lKX1gKVxuICAgIHNxbHMucHVzaChgQUxURVIgVEFCTEUgJHtvcHRpb25zLnF1b3RlVGFibGVOYW1lKHRlbXBUYWJsZU5hbWUpfSBSRU5BTUUgVE8gJHtvcHRpb25zLnF1b3RlVGFibGVOYW1lKG9yaWdpbmFsVGFibGVOYW1lKX1gKVxuXG4gICAgZm9yIChjb25zdCB0YWJsZURhdGFJbmRleCBvZiB0YXJnZXRUYWJsZURhdGEuZ2V0SW5kZXhlcygpKSB7XG4gICAgICBjb25zdCBjcmVhdGVJbmRleFNRTHMgPSBhd2FpdCBuZXcgQ3JlYXRlSW5kZXhCYXNlKHtcbiAgICAgICAgY29sdW1uczogdGFibGVEYXRhSW5kZXguZ2V0Q29sdW1ucygpLFxuICAgICAgICBkcml2ZXIsXG4gICAgICAgIG5hbWU6IHRhYmxlRGF0YUluZGV4LmdldE5hbWUoKSxcbiAgICAgICAgdGFibGVOYW1lOiBvcmlnaW5hbFRhYmxlTmFtZSxcbiAgICAgICAgdW5pcXVlOiB0YWJsZURhdGFJbmRleC5nZXRVbmlxdWUoKVxuICAgICAgfSkudG9TUUxzKClcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2YgY3JlYXRlSW5kZXhTUUxzKSBzcWxzLnB1c2goc3FsKVxuICAgIH1cblxuICAgIHJldHVybiBzcWxzXG4gIH1cbn1cbiJdfQ==