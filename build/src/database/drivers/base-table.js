// @ts-check
import { digg } from "diggerize";
import TableData from "../table-data/index.js";
export default class VelociousDatabaseDriversBaseTable {
    /**
     * Driver.
     * @type {import("./base.js").default | undefined} */
    driver = undefined;
    /**
     * Runs get column by name.
     * @param {string} columnName - Column name.
     * @returns {Promise<import("./base-column.js").default | undefined>} - Resolves with the column by name.
     */
    async getColumnByName(columnName) {
        const columnes = await this.getColumns();
        const column = columnes.find((column) => column.getName() == columnName);
        return column;
    }
    /**
     * Runs get column by name or fail.
     * @param {string} columnName - Column name.
     * @returns {Promise<import("./base-column.js").default>} - Resolves with the column by name or fail.
     */
    async getColumnByNameOrFail(columnName) {
        const column = await this.getColumnByName(columnName);
        if (!column)
            throw new Error(`Couldn't find a column by that name "${columnName}"`);
        return column;
    }
    /**
     * Runs get columns.
     * @abstract
     * @returns {Promise<Array<import("./base-column.js").default>>} - Resolves with the columns.
     */
    getColumns() {
        throw new Error("getColumns not implemented");
    }
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver() {
        if (!this.driver)
            throw new Error("No driver set on table");
        return this.driver;
    }
    /**
     * Runs get foreign keys.
     * @abstract
     * @returns {Promise<import("./base-foreign-key.js").default[]>} - Resolves with the foreign keys.
     */
    getForeignKeys() {
        throw new Error("'getForeignKeys' not implemented");
    }
    /**
     * Runs get indexes.
     * @abstract
     * @returns {Promise<import("./base-columns-index.js").default[]>} - Resolves with the indexes.
     */
    getIndexes() {
        throw new Error("'getForeignKeys' not implemented");
    }
    /**
     * Runs get name.
     * @abstract
     * @returns {string} - The name.
     */
    getName() {
        throw new Error("getName not implemented");
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.getDriver().options();
    }
    /**
     * Runs get table data.
     * @returns {Promise<TableData>} - Resolves with the table data.
     */
    async getTableData() {
        const tableData = new TableData(this.getName());
        const tableDataColumns = [];
        for (const column of await this.getColumns()) {
            const tableDataColumn = column.getTableDataColumn();
            tableData.addColumn(tableDataColumn);
            tableDataColumns.push(tableDataColumn);
        }
        for (const foreignKey of await this.getForeignKeys()) {
            const tableDataForeignKey = foreignKey.getTableDataForeignKey();
            tableData.addForeignKey(tableDataForeignKey);
            const tableDataColumn = tableDataColumns.find((tableDataColumn) => tableDataColumn.getName() == foreignKey.getColumnName());
            if (!tableDataColumn)
                throw new Error(`Couldn't find table data column for foreign key: ${foreignKey.getColumnName()}`);
            tableDataColumn.setForeignKey(tableDataForeignKey);
        }
        for (const index of await this.getIndexes()) {
            tableData.addIndex(index.getTableDataIndex());
        }
        return tableData;
    }
    /**
     * Runs rows count.
     * @returns {Promise<number>} - Resolves with the rows count.
     */
    async rowsCount() {
        const result = await this.getDriver().query(`SELECT COUNT(*) AS count FROM ${this.getOptions().quoteTableName(this.getName())}`);
        return digg(result, 0, "count");
    }
    /**
     * Runs truncate.
     * @param {{cascade: boolean}} [args] - Truncate options.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Resolves with the truncate.
     */
    async truncate(args) {
        this.getDriver()._assertNotReadOnly();
        const databaseType = this.getDriver().getType();
        let sql;
        if (databaseType == "sqlite") {
            sql = `DELETE FROM ${this.getOptions().quoteTableName(this.getName())}`;
        }
        else {
            sql = `TRUNCATE TABLE ${this.getOptions().quoteTableName(this.getName())}`;
            if (args?.cascade && databaseType == "pgsql") {
                sql += " CASCADE";
            }
        }
        return await this.getDriver().query(sql);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS10YWJsZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UtdGFibGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFFOUMsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQ0FBaUM7SUFDcEQ7O3lEQUVxRDtJQUNyRCxNQUFNLEdBQUcsU0FBUyxDQUFBO0lBRWxCOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFVBQVU7UUFDOUIsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDeEMsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxJQUFJLFVBQVUsQ0FBQyxDQUFBO1FBRXhFLE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsVUFBVTtRQUNwQyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFckQsSUFBSSxDQUFDLE1BQU07WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxVQUFVLEdBQUcsQ0FBQyxDQUFBO1FBRW5GLE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVO1FBQ1IsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTO1FBQ1AsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxD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LEVBQUUsQ0FBQTtRQUN6RSxDQUFDO2FBQU0sQ0FBQztZQUNOLEdBQUcsR0FBRyxrQkFBa0IsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxDQUFBO1lBRTFFLElBQUksSUFBSSxFQUFFLE9BQU8sSUFBSSxZQUFZLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQzdDLEdBQUcsSUFBSSxVQUFVLENBQUE7WUFDbkIsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUMxQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlVGFibGUge1xuICAvKipcbiAgICogRHJpdmVyLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIGRyaXZlciA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb2x1bW4gYnkgbmFtZS5cbiAgICovXG4gIGFzeW5jIGdldENvbHVtbkJ5TmFtZShjb2x1bW5OYW1lKSB7XG4gICAgY29uc3QgY29sdW1uZXMgPSBhd2FpdCB0aGlzLmdldENvbHVtbnMoKVxuICAgIGNvbnN0IGNvbHVtbiA9IGNvbHVtbmVzLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PSBjb2x1bW5OYW1lKVxuXG4gICAgcmV0dXJuIGNvbHVtblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbiBieSBuYW1lIG9yIGZhaWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29sdW1uIGJ5IG5hbWUgb3IgZmFpbC5cbiAgICovXG4gIGFzeW5jIGdldENvbHVtbkJ5TmFtZU9yRmFpbChjb2x1bW5OYW1lKSB7XG4gICAgY29uc3QgY29sdW1uID0gYXdhaXQgdGhpcy5nZXRDb2x1bW5CeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmICghY29sdW1uKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGZpbmQgYSBjb2x1bW4gYnkgdGhhdCBuYW1lIFwiJHtjb2x1bW5OYW1lfVwiYClcblxuICAgIHJldHVybiBjb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW5zLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29sdW1ucy5cbiAgICovXG4gIGdldENvbHVtbnMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0Q29sdW1ucyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkcml2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZHJpdmVyLlxuICAgKi9cbiAgZ2V0RHJpdmVyKCkge1xuICAgIGlmICghdGhpcy5kcml2ZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBzZXQgb24gdGFibGVcIilcblxuICAgIHJldHVybiB0aGlzLmRyaXZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZvcmVpZ24ga2V5cy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS1mb3JlaWduLWtleS5qc1wiKS5kZWZhdWx0W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZvcmVpZ24ga2V5cy5cbiAgICovXG4gIGdldEZvcmVpZ25LZXlzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidnZXRGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaW5kZXhlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgaW5kZXhlcy5cbiAgICovXG4gIGdldEluZGV4ZXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2dldEZvcmVpZ25LZXlzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBuYW1lLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbmFtZS5cbiAgICovXG4gIGdldE5hbWUoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0TmFtZSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXREcml2ZXIoKS5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUYWJsZURhdGE+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlIGRhdGEuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0aGlzLmdldE5hbWUoKSlcbiAgICBjb25zdCB0YWJsZURhdGFDb2x1bW5zID0gW11cblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIGF3YWl0IHRoaXMuZ2V0Q29sdW1ucygpKSB7XG4gICAgICBjb25zdCB0YWJsZURhdGFDb2x1bW4gPSBjb2x1bW4uZ2V0VGFibGVEYXRhQ29sdW1uKClcblxuICAgICAgdGFibGVEYXRhLmFkZENvbHVtbih0YWJsZURhdGFDb2x1bW4pXG4gICAgICB0YWJsZURhdGFDb2x1bW5zLnB1c2godGFibGVEYXRhQ29sdW1uKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZm9yZWlnbktleSBvZiBhd2FpdCB0aGlzLmdldEZvcmVpZ25LZXlzKCkpIHtcbiAgICAgIGNvbnN0IHRhYmxlRGF0YUZvcmVpZ25LZXkgPSBmb3JlaWduS2V5LmdldFRhYmxlRGF0YUZvcmVpZ25LZXkoKVxuXG4gICAgICB0YWJsZURhdGEuYWRkRm9yZWlnbktleSh0YWJsZURhdGFGb3JlaWduS2V5KVxuXG4gICAgICBjb25zdCB0YWJsZURhdGFDb2x1bW4gPSB0YWJsZURhdGFDb2x1bW5zLmZpbmQoKHRhYmxlRGF0YUNvbHVtbikgPT4gdGFibGVEYXRhQ29sdW1uLmdldE5hbWUoKSA9PSBmb3JlaWduS2V5LmdldENvbHVtbk5hbWUoKSlcblxuICAgICAgaWYgKCF0YWJsZURhdGFDb2x1bW4pIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZmluZCB0YWJsZSBkYXRhIGNvbHVtbiBmb3IgZm9yZWlnbiBrZXk6ICR7Zm9yZWlnbktleS5nZXRDb2x1bW5OYW1lKCl9YClcblxuICAgICAgdGFibGVEYXRhQ29sdW1uLnNldEZvcmVpZ25LZXkodGFibGVEYXRhRm9yZWlnbktleSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGluZGV4IG9mIGF3YWl0IHRoaXMuZ2V0SW5kZXhlcygpKSB7XG4gICAgICB0YWJsZURhdGEuYWRkSW5kZXgoaW5kZXguZ2V0VGFibGVEYXRhSW5kZXgoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGFibGVEYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb3dzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJvd3MgY291bnQuXG4gICAqL1xuICBhc3luYyByb3dzQ291bnQoKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5xdWVyeShgU0VMRUNUIENPVU5UKCopIEFTIGNvdW50IEZST00gJHt0aGlzLmdldE9wdGlvbnMoKS5xdW90ZVRhYmxlTmFtZSh0aGlzLmdldE5hbWUoKSl9YClcblxuICAgIHJldHVybiBkaWdnKHJlc3VsdCwgMCwgXCJjb3VudFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUuXG4gICAqIEBwYXJhbSB7e2Nhc2NhZGU6IGJvb2xlYW59fSBbYXJnc10gLSBUcnVuY2F0ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0cnVuY2F0ZS5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlKGFyZ3MpIHtcbiAgICB0aGlzLmdldERyaXZlcigpLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gdGhpcy5nZXREcml2ZXIoKS5nZXRUeXBlKClcbiAgICBsZXQgc3FsXG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwic3FsaXRlXCIpIHtcbiAgICAgIHNxbCA9IGBERUxFVEUgRlJPTSAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRoaXMuZ2V0TmFtZSgpKX1gXG4gICAgfSBlbHNlIHtcbiAgICAgIHNxbCA9IGBUUlVOQ0FURSBUQUJMRSAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRoaXMuZ2V0TmFtZSgpKX1gXG5cbiAgICAgIGlmIChhcmdzPy5jYXNjYWRlICYmIGRhdGFiYXNlVHlwZSA9PSBcInBnc3FsXCIpIHtcbiAgICAgICAgc3FsICs9IFwiIENBU0NBREVcIlxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KHNxbClcbiAgfVxufVxuIl19