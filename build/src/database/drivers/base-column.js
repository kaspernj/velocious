// @ts-check
import TableColumn from "../table-data/table-column.js";
import TableData from "../table-data/index.js";
export default class VelociousDatabaseDriversBaseColumn {
    /**
     * Table.
     * @type {import("./base-table.js").default | undefined} */
    table = undefined;
    /**
     * Runs get auto increment.
     * @abstract
     * @returns {boolean} - Whether auto increment.
     */
    getAutoIncrement() {
        throw new Error("getAutoIncrement not implemented");
    }
    /**
     * Runs get default.
     * @abstract
     * @returns {ReturnType<typeof JSON.parse>} - The default.
     */
    getDefault() {
        throw new Error("getDefault not implemented");
    }
    /**
     * Runs get index by name.
     * @param {string} indexName - Index name.
     * @returns {Promise<import("./base-columns-index.js").default | undefined>} - Resolves with the index by name.
     */
    async getIndexByName(indexName) {
        const indexes = await this.getIndexes();
        const index = indexes.find((index) => index.getName() == indexName);
        return index;
    }
    /**
     * Runs change nullable.
     * @param {boolean} nullable Whether the column should be nullable or not.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async changeNullable(nullable) {
        const tableData = new TableData(this.getTable().getName());
        const column = this.getTableDataColumn();
        column.setNull(nullable);
        tableData.addColumn(column);
        const sqls = await this.getDriver().alterTableSQLs(tableData);
        for (const sql of sqls) {
            await this.getDriver().query(sql);
        }
    }
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver() {
        return this.getTable().getDriver();
    }
    /**
     * Runs get indexes.
     * @abstract
     * @returns {Promise<Array<import("./base-columns-index.js").default>>} - Resolves with the indexes.
     */
    getIndexes() {
        throw new Error("getIndexes not implemented");
    }
    /**
     * Runs get max length.
     * @abstract
     * @returns {number | undefined} - The max length.
     */
    getMaxLength() {
        throw new Error("getMaxLength not implemented");
    }
    /**
     * Runs get notes.
     * @returns {string | undefined} - The notes.
     */
    getNotes() {
        return undefined;
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
     * Runs get null.
     * @abstract
     * @returns {boolean} - Whether null.
     */
    getNull() {
        throw new Error("getNull not implemented");
    }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() {
        return this.getDriver().options();
    }
    /**
     * Runs get primary key.
     * @abstract
     * @returns {boolean} - Whether primary key.
     */
    getPrimaryKey() {
        throw new Error("getPrimaryKey not implemented");
    }
    /**
     * Runs get table.
     * @returns {import("./base-table.js").default} - The table.
     */
    getTable() {
        if (!this.table)
            throw new Error("No table set on column");
        return this.table;
    }
    /**
     * Runs get table data column.
     * @returns {TableColumn} The table column data for this column. This is used for altering tables and such.
     */
    getTableDataColumn() {
        return new TableColumn(this.getName(), {
            autoIncrement: this.getAutoIncrement(),
            default: this.getDefault(),
            isNewColumn: false,
            maxLength: this.getMaxLength(),
            notes: this.getNotes(),
            null: this.getNull(),
            primaryKey: this.getPrimaryKey(),
            type: this.getType()
        });
    }
    /**
     * Runs get type hint from notes.
     * @returns {string | undefined} - The type hint from notes.
     */
    getTypeHintFromNotes() {
        const notes = this.getNotes();
        if (!notes || typeof notes != "string")
            return;
        const match = notes.match(/velocious:type=([a-z0-9_-]+)/i);
        if (!match)
            return;
        return match[1].toLowerCase();
    }
    /**
     * Runs get type.
     * @abstract
     * @returns {string} - The type.
     */
    getType() {
        throw new Error("getType not implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1jb2x1bW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9iYXNlLWNvbHVtbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxXQUFXLE1BQU0sK0JBQStCLENBQUE7QUFDdkQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFFOUMsTUFBTSxDQUFDLE9BQU8sT0FBTyxrQ0FBa0M7SUFDckQ7OytEQUUyRDtJQUMzRCxLQUFLLEdBQUcsU0FBUyxDQUFBO0lBRWpCOzs7O09BSUc7SUFDSCxnQkFBZ0I7UUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUE7SUFDckQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVO1FBQ1IsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFTO1FBQzVCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ3ZDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxTQUFTLENBQUMsQ0FBQTtRQUVuRSxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRO1FBQzNCLE1BQU0sU0FBUyxHQUFHLElBQUksU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBQzFELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBRXhDLE1BQU0sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFeEIsU0FBUyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUzQixNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFN0QsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTO1FBQ1AsT0FBTyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVO1FBQ1IsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsWUFBWTtRQUNWLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsUUFBUTtRQUNOLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsT0FBTztRQUNMLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE9BQU87UUFDTCxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixPQUFPLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWE7UUFDWCxNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUE7SUFDbEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFFMUQsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO0lBQ25CLENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQkFBa0I7UUFDaEIsT0FBTyxJQUFJLFdBQVcsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDckMsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtZQUN0QyxPQUFPLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRTtZQUMxQixXQUFXLEVBQUUsS0FBSztZQUNsQixTQUFTLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRTtZQUM5QixLQUFLLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRTtZQUN0QixJQUFJLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUNwQixVQUFVLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRTtZQUNoQyxJQUFJLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRTtTQUNyQixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsb0JBQW9CO1FBQ2xCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUU3QixJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJLFFBQVE7WUFBRSxPQUFNO1FBRTlDLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQTtRQUUxRCxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU07UUFFbEIsT0FBTyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDL0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxPQUFPO1FBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFBO0lBQzVDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVGFibGVDb2x1bW4gZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlQ29sdW1uIHtcbiAgLyoqXG4gICAqIFRhYmxlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIHRhYmxlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG8gaW5jcmVtZW50LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhdXRvIGluY3JlbWVudC5cbiAgICovXG4gIGdldEF1dG9JbmNyZW1lbnQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0QXV0b0luY3JlbWVudCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWZhdWx0LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBkZWZhdWx0LlxuICAgKi9cbiAgZ2V0RGVmYXVsdCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJnZXREZWZhdWx0IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGluZGV4IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpbmRleE5hbWUgLSBJbmRleCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Jhc2UtY29sdW1ucy1pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBpbmRleCBieSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgZ2V0SW5kZXhCeU5hbWUoaW5kZXhOYW1lKSB7XG4gICAgY29uc3QgaW5kZXhlcyA9IGF3YWl0IHRoaXMuZ2V0SW5kZXhlcygpXG4gICAgY29uc3QgaW5kZXggPSBpbmRleGVzLmZpbmQoKGluZGV4KSA9PiBpbmRleC5nZXROYW1lKCkgPT0gaW5kZXhOYW1lKVxuXG4gICAgcmV0dXJuIGluZGV4XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFuZ2UgbnVsbGFibGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbnVsbGFibGUgV2hldGhlciB0aGUgY29sdW1uIHNob3VsZCBiZSBudWxsYWJsZSBvciBub3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjaGFuZ2VOdWxsYWJsZShudWxsYWJsZSkge1xuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGhpcy5nZXRUYWJsZSgpLmdldE5hbWUoKSlcbiAgICBjb25zdCBjb2x1bW4gPSB0aGlzLmdldFRhYmxlRGF0YUNvbHVtbigpXG5cbiAgICBjb2x1bW4uc2V0TnVsbChudWxsYWJsZSlcblxuICAgIHRhYmxlRGF0YS5hZGRDb2x1bW4oY29sdW1uKVxuXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRyaXZlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBkcml2ZXIuXG4gICAqL1xuICBnZXREcml2ZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VGFibGUoKS5nZXREcml2ZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGluZGV4ZXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuL2Jhc2UtY29sdW1ucy1pbmRleC5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgaW5kZXhlcy5cbiAgICovXG4gIGdldEluZGV4ZXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0SW5kZXhlcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtYXggbGVuZ3RoLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaGUgbWF4IGxlbmd0aC5cbiAgICovXG4gIGdldE1heExlbmd0aCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJnZXRNYXhMZW5ndGggbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbm90ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIG5vdGVzLlxuICAgKi9cbiAgZ2V0Tm90ZXMoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBuYW1lLlxuICAgKi9cbiAgZ2V0TmFtZSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJnZXROYW1lIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG51bGwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG51bGwuXG4gICAqL1xuICBnZXROdWxsKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldE51bGwgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RHJpdmVyKCkub3B0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJpbWFyeSBrZXkuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1hcnkga2V5LlxuICAgKi9cbiAgZ2V0UHJpbWFyeUtleSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJnZXRQcmltYXJ5S2V5IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHRhYmxlLlxuICAgKi9cbiAgZ2V0VGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLnRhYmxlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyB0YWJsZSBzZXQgb24gY29sdW1uXCIpXG5cbiAgICByZXR1cm4gdGhpcy50YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIGRhdGEgY29sdW1uLlxuICAgKiBAcmV0dXJucyB7VGFibGVDb2x1bW59IFRoZSB0YWJsZSBjb2x1bW4gZGF0YSBmb3IgdGhpcyBjb2x1bW4uIFRoaXMgaXMgdXNlZCBmb3IgYWx0ZXJpbmcgdGFibGVzIGFuZCBzdWNoLlxuICAgKi9cbiAgZ2V0VGFibGVEYXRhQ29sdW1uKCkge1xuICAgIHJldHVybiBuZXcgVGFibGVDb2x1bW4odGhpcy5nZXROYW1lKCksIHtcbiAgICAgIGF1dG9JbmNyZW1lbnQ6IHRoaXMuZ2V0QXV0b0luY3JlbWVudCgpLFxuICAgICAgZGVmYXVsdDogdGhpcy5nZXREZWZhdWx0KCksXG4gICAgICBpc05ld0NvbHVtbjogZmFsc2UsXG4gICAgICBtYXhMZW5ndGg6IHRoaXMuZ2V0TWF4TGVuZ3RoKCksXG4gICAgICBub3RlczogdGhpcy5nZXROb3RlcygpLFxuICAgICAgbnVsbDogdGhpcy5nZXROdWxsKCksXG4gICAgICBwcmltYXJ5S2V5OiB0aGlzLmdldFByaW1hcnlLZXkoKSxcbiAgICAgIHR5cGU6IHRoaXMuZ2V0VHlwZSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlIGhpbnQgZnJvbSBub3Rlcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgdHlwZSBoaW50IGZyb20gbm90ZXMuXG4gICAqL1xuICBnZXRUeXBlSGludEZyb21Ob3RlcygpIHtcbiAgICBjb25zdCBub3RlcyA9IHRoaXMuZ2V0Tm90ZXMoKVxuXG4gICAgaWYgKCFub3RlcyB8fCB0eXBlb2Ygbm90ZXMgIT0gXCJzdHJpbmdcIikgcmV0dXJuXG5cbiAgICBjb25zdCBtYXRjaCA9IG5vdGVzLm1hdGNoKC92ZWxvY2lvdXM6dHlwZT0oW2EtejAtOV8tXSspL2kpXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm5cblxuICAgIHJldHVybiBtYXRjaFsxXS50b0xvd2VyQ2FzZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldFR5cGUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cbn1cbiJdfQ==