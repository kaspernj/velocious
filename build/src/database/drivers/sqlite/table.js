// @ts-check
import BaseTable from "../base-table.js";
import Column from "./column.js";
import ColumnsIndex from "./columns-index.js";
import ForeignKey from "./foreign-key.js";
export default class VelociousDatabaseDriversSqliteTable extends BaseTable {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     * @param {Record<string, string | number | null>} args.row - Row data.
     */
    constructor({ driver, row }) {
        super();
        this.driver = driver;
        this.row = row;
    }
    /**
     * Runs get columns.
     * @returns {Promise<Array<import("../base-column.js").default>>} - Resolves with the columns.
     */
    async getColumns() {
        return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "columns", async () => {
            const result = await this.driver.query(`PRAGMA table_info('${this.getName()}')`);
            const columns = [];
            for (const columnData of result) {
                const column = new Column({ column: columnData, driver: this.driver, table: this });
                columns.push(column);
            }
            return columns;
        });
    }
    async getForeignKeys() {
        return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "foreignKeys", async () => {
            const foreignKeysData = await this.driver.query(`SELECT * FROM pragma_foreign_key_list(${this.driver.quote(this.getName())})`);
            const foreignKeys = [];
            for (const foreignKeyData of foreignKeysData) {
                const foreignKey = new ForeignKey(foreignKeyData, { tableName: this.getName() });
                foreignKeys.push(foreignKey);
            }
            return foreignKeys;
        });
    }
    async getIndexes() {
        return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "indexes", async () => {
            const rows = await this.getDriver().query(`PRAGMA index_list(${this.getOptions().quoteTableName(this.getName())})`);
            const indexes = [];
            for (const row of rows) {
                const indexName = row.name;
                if (typeof indexName == "string" && indexName.startsWith("sqlite_autoindex_")) {
                    // Skip SQLite internal auto indexes (e.g. primary key / unique constraints)
                    continue;
                }
                const columnsIndex = new ColumnsIndex(this, row);
                const indexMasterData = await this.getDriver().query(`SELECT * FROM sqlite_master WHERE type = 'index' AND name = ${this.getOptions().quote(columnsIndex.getName())}`);
                const sql = indexMasterData[0]?.sql;
                if (!sql)
                    throw new Error(`Could not find SQL for index ${columnsIndex.getName()}`);
                const indexData = /** @type {typeof columnsIndex.data & {columnNames?: string[]}} */ (columnsIndex.data);
                indexData.columnNames = this._parseColumnsFromSQL(String(sql));
                indexes.push(columnsIndex);
            }
            return indexes;
        });
    }
    /**
     * Runs parse columns from sql.
     * @param {string} sql - SQL string.
     * @returns {string[]} - SQL statements.
     */
    _parseColumnsFromSQL(sql) {
        if (!sql)
            throw new Error(`Invalid SQL given (${typeof sql}): ${sql}`);
        const columnsSQLMatch = sql.match(/\((.+?)\)/);
        if (!columnsSQLMatch) {
            throw new Error(`Could not match columns from SQL: ${sql}`);
        }
        const columnsSQL = columnsSQLMatch[1].split(",");
        const columnNames = [];
        for (const column of columnsSQL) {
            const matchTicks = column.match(/`(.+)`/);
            const matchQuotes = column.match(/"(.+)"/);
            if (matchTicks) {
                columnNames.push(matchTicks[1]);
            }
            else if (matchQuotes) {
                columnNames.push(matchQuotes[1]);
            }
            else {
                throw new Error(`Couldn't parse column part: ${column}`);
            }
        }
        return columnNames;
    }
    /**
     * Runs get name.
     * @returns {string} - The table name.
     */
    getName() {
        if (!this.row.name) {
            throw new Error("No name given for SQLite table");
        }
        return String(this.row.name);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvdGFibGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLGtCQUFrQixDQUFBO0FBQ3hDLE9BQU8sTUFBTSxNQUFNLGFBQWEsQ0FBQTtBQUNoQyxPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUM3QyxPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUV6QyxNQUFNLENBQUMsT0FBTyxPQUFPLG1DQUFvQyxTQUFRLFNBQVM7SUFDeEU7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLEdBQUcsRUFBQztRQUN2QixLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO1FBQ3BCLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsVUFBVTtRQUNkLE9BQU8sTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsMEJBQTBCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM3RixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHNCQUFzQixJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFBO1lBQ2hGLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQTtZQUVsQixLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNoQyxNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxFQUFDLE1BQU0sRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JB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LElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDOUIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlVGFibGUgZnJvbSBcIi4uL2Jhc2UtdGFibGUuanNcIlxuaW1wb3J0IENvbHVtbiBmcm9tIFwiLi9jb2x1bW4uanNcIlxuaW1wb3J0IENvbHVtbnNJbmRleCBmcm9tIFwiLi9jb2x1bW5zLWluZGV4LmpzXCJcbmltcG9ydCBGb3JlaWduS2V5IGZyb20gXCIuL2ZvcmVpZ24ta2V5LmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlVGFibGUgZXh0ZW5kcyBCYXNlVGFibGUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZHJpdmVyIC0gRGF0YWJhc2UgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IG51bGw+fSBhcmdzLnJvdyAtIFJvdyBkYXRhLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2RyaXZlciwgcm93fSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmRyaXZlciA9IGRyaXZlclxuICAgIHRoaXMucm93ID0gcm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbHVtbnMuXG4gICAqL1xuICBhc3luYyBnZXRDb2x1bW5zKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLl9jYWNoZWRUYWJsZVNjaGVtYU1ldGFkYXRhKHRoaXMuZ2V0TmFtZSgpLCBcImNvbHVtbnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kcml2ZXIucXVlcnkoYFBSQUdNQSB0YWJsZV9pbmZvKCcke3RoaXMuZ2V0TmFtZSgpfScpYClcbiAgICAgIGNvbnN0IGNvbHVtbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbkRhdGEgb2YgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGNvbHVtbiA9IG5ldyBDb2x1bW4oe2NvbHVtbjogY29sdW1uRGF0YSwgZHJpdmVyOiB0aGlzLmRyaXZlciwgdGFibGU6IHRoaXN9KVxuXG4gICAgICAgIGNvbHVtbnMucHVzaChjb2x1bW4pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb2x1bW5zXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGdldEZvcmVpZ25LZXlzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLl9jYWNoZWRUYWJsZVNjaGVtYU1ldGFkYXRhKHRoaXMuZ2V0TmFtZSgpLCBcImZvcmVpZ25LZXlzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlzRGF0YSA9IGF3YWl0IHRoaXMuZHJpdmVyLnF1ZXJ5KGBTRUxFQ1QgKiBGUk9NIHByYWdtYV9mb3JlaWduX2tleV9saXN0KCR7dGhpcy5kcml2ZXIucXVvdGUodGhpcy5nZXROYW1lKCkpfSlgKVxuICAgICAgY29uc3QgZm9yZWlnbktleXMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGZvcmVpZ25LZXlEYXRhIG9mIGZvcmVpZ25LZXlzRGF0YSkge1xuICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbmV3IEZvcmVpZ25LZXkoZm9yZWlnbktleURhdGEsIHt0YWJsZU5hbWU6IHRoaXMuZ2V0TmFtZSgpfSlcblxuICAgICAgICBmb3JlaWduS2V5cy5wdXNoKGZvcmVpZ25LZXkpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBmb3JlaWduS2V5c1xuICAgIH0pXG4gIH1cblxuICBhc3luYyBnZXRJbmRleGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLl9jYWNoZWRUYWJsZVNjaGVtYU1ldGFkYXRhKHRoaXMuZ2V0TmFtZSgpLCBcImluZGV4ZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkucXVlcnkoYFBSQUdNQSBpbmRleF9saXN0KCR7dGhpcy5nZXRPcHRpb25zKCkucXVvdGVUYWJsZU5hbWUodGhpcy5nZXROYW1lKCkpfSlgKVxuICAgICAgY29uc3QgaW5kZXhlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgaW5kZXhOYW1lID0gcm93Lm5hbWVcblxuICAgICAgICBpZiAodHlwZW9mIGluZGV4TmFtZSA9PSBcInN0cmluZ1wiICYmIGluZGV4TmFtZS5zdGFydHNXaXRoKFwic3FsaXRlX2F1dG9pbmRleF9cIikpIHtcbiAgICAgICAgICAvLyBTa2lwIFNRTGl0ZSBpbnRlcm5hbCBhdXRvIGluZGV4ZXMgKGUuZy4gcHJpbWFyeSBrZXkgLyB1bmlxdWUgY29uc3RyYWludHMpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbHVtbnNJbmRleCA9IG5ldyBDb2x1bW5zSW5kZXgodGhpcywgcm93KVxuICAgICAgICBjb25zdCBpbmRleE1hc3RlckRhdGEgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KGBTRUxFQ1QgKiBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdHlwZSA9ICdpbmRleCcgQU5EIG5hbWUgPSAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlKGNvbHVtbnNJbmRleC5nZXROYW1lKCkpfWApXG4gICAgICAgIGNvbnN0IHNxbCA9IGluZGV4TWFzdGVyRGF0YVswXT8uc3FsXG5cbiAgICAgICAgaWYgKCFzcWwpIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGZpbmQgU1FMIGZvciBpbmRleCAke2NvbHVtbnNJbmRleC5nZXROYW1lKCl9YClcblxuICAgICAgICBjb25zdCBpbmRleERhdGEgPSAvKiogQHR5cGUge3R5cGVvZiBjb2x1bW5zSW5kZXguZGF0YSAmIHtjb2x1bW5OYW1lcz86IHN0cmluZ1tdfX0gKi8gKGNvbHVtbnNJbmRleC5kYXRhKVxuXG4gICAgICAgIGluZGV4RGF0YS5jb2x1bW5OYW1lcyA9IHRoaXMuX3BhcnNlQ29sdW1uc0Zyb21TUUwoU3RyaW5nKHNxbCkpXG5cbiAgICAgICAgaW5kZXhlcy5wdXNoKGNvbHVtbnNJbmRleClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGluZGV4ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgY29sdW1ucyBmcm9tIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIF9wYXJzZUNvbHVtbnNGcm9tU1FMKHNxbCkge1xuICAgIGlmICghc3FsKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgU1FMIGdpdmVuICgke3R5cGVvZiBzcWx9KTogJHtzcWx9YClcblxuICAgIGNvbnN0IGNvbHVtbnNTUUxNYXRjaCA9IHNxbC5tYXRjaCgvXFwoKC4rPylcXCkvKVxuXG4gICAgaWYgKCFjb2x1bW5zU1FMTWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IG1hdGNoIGNvbHVtbnMgZnJvbSBTUUw6ICR7c3FsfWApXG4gICAgfVxuXG4gICAgY29uc3QgY29sdW1uc1NRTCA9IGNvbHVtbnNTUUxNYXRjaFsxXS5zcGxpdChcIixcIilcbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiBjb2x1bW5zU1FMKSB7XG4gICAgICBjb25zdCBtYXRjaFRpY2tzID0gY29sdW1uLm1hdGNoKC9gKC4rKWAvKVxuICAgICAgY29uc3QgbWF0Y2hRdW90ZXMgPSBjb2x1bW4ubWF0Y2goL1wiKC4rKVwiLylcblxuICAgICAgaWYgKG1hdGNoVGlja3MpIHtcbiAgICAgICAgY29sdW1uTmFtZXMucHVzaChtYXRjaFRpY2tzWzFdKVxuICAgICAgfSBlbHNlIGlmIChtYXRjaFF1b3Rlcykge1xuICAgICAgICBjb2x1bW5OYW1lcy5wdXNoKG1hdGNoUXVvdGVzWzFdKVxuICAgICAgfSBlbHNle1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IHBhcnNlIGNvbHVtbiBwYXJ0OiAke2NvbHVtbn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb2x1bW5OYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkge1xuICAgIGlmICghdGhpcy5yb3cubmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gbmFtZSBnaXZlbiBmb3IgU1FMaXRlIHRhYmxlXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIFN0cmluZyh0aGlzLnJvdy5uYW1lKVxuICB9XG59XG4iXX0=