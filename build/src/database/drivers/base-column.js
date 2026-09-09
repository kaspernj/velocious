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
     * Returns the database-native type name used in SQL casts.
     * @returns {string} - Database-native type name.
     */
    getDatabaseType() {
        return this.getType();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1jb2x1bW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9iYXNlLWNvbHVtbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxXQUFXLE1BQU0sK0JBQStCLENBQUE7QUFDdkQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFFOUMsTUFBTSxDQUFDLE9BQU8sT0FBTyxrQ0FBa0M7SUFDckQ7OytEQUUyRDtJQUMzRCxLQUFLLEdBQUcsU0FBUyxDQUFBO0lBRWpCOzs7O09BSUc7SUFDSCxnQkFBZ0I7UUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUE7SUFDckQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVO1FBQ1IsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFTO1FBQzVCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ3ZDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxTQUFTLENBQUMsQ0FBQTtRQUVuRSxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRO1FBQzNCLE1BQU0sU0FBUyxHQUFHLElBQUksU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBQzFELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBRXhDLE1BQU0sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFeEIsU0FBUyxDQUFD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cG9ydCBUYWJsZUNvbHVtbiBmcm9tIFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2VDb2x1bW4ge1xuICAvKipcbiAgICogVGFibGUuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgdGFibGUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0byBpbmNyZW1lbnQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGF1dG8gaW5jcmVtZW50LlxuICAgKi9cbiAgZ2V0QXV0b0luY3JlbWVudCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJnZXRBdXRvSW5jcmVtZW50IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlZmF1bHQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGRlZmF1bHQuXG4gICAqL1xuICBnZXREZWZhdWx0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldERlZmF1bHQgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaW5kZXggYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGluZGV4TmFtZSAtIEluZGV4IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGluZGV4IGJ5IG5hbWUuXG4gICAqL1xuICBhc3luYyBnZXRJbmRleEJ5TmFtZShpbmRleE5hbWUpIHtcbiAgICBjb25zdCBpbmRleGVzID0gYXdhaXQgdGhpcy5nZXRJbmRleGVzKClcbiAgICBjb25zdCBpbmRleCA9IGluZGV4ZXMuZmluZCgoaW5kZXgpID0+IGluZGV4LmdldE5hbWUoKSA9PSBpbmRleE5hbWUpXG5cbiAgICByZXR1cm4gaW5kZXhcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5nZSBudWxsYWJsZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBudWxsYWJsZSBXaGV0aGVyIHRoZSBjb2x1bW4gc2hvdWxkIGJlIG51bGxhYmxlIG9yIG5vdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNoYW5nZU51bGxhYmxlKG51bGxhYmxlKSB7XG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0aGlzLmdldFRhYmxlKCkuZ2V0TmFtZSgpKVxuICAgIGNvbnN0IGNvbHVtbiA9IHRoaXMuZ2V0VGFibGVEYXRhQ29sdW1uKClcblxuICAgIGNvbHVtbi5zZXROdWxsKG51bGxhYmxlKVxuXG4gICAgdGFibGVEYXRhLmFkZENvbHVtbihjb2x1bW4pXG5cbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZHJpdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRyaXZlci5cbiAgICovXG4gIGdldERyaXZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRUYWJsZSgpLmdldERyaXZlcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaW5kZXhlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBpbmRleGVzLlxuICAgKi9cbiAgZ2V0SW5kZXhlcygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJnZXRJbmRleGVzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1heCBsZW5ndGguXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSBtYXggbGVuZ3RoLlxuICAgKi9cbiAgZ2V0TWF4TGVuZ3RoKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldE1heExlbmd0aCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBub3Rlcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgbm90ZXMuXG4gICAqL1xuICBnZXROb3RlcygpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbmFtZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldE5hbWUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbnVsbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbnVsbC5cbiAgICovXG4gIGdldE51bGwoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZ2V0TnVsbCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXREcml2ZXIoKS5vcHRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmltYXJ5IGtleS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBnZXRQcmltYXJ5S2V5KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldFByaW1hcnlLZXkgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gLSBUaGUgdGFibGUuXG4gICAqL1xuICBnZXRUYWJsZSgpIHtcbiAgICBpZiAoIXRoaXMudGFibGUpIHRocm93IG5ldyBFcnJvcihcIk5vIHRhYmxlIHNldCBvbiBjb2x1bW5cIilcblxuICAgIHJldHVybiB0aGlzLnRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgZGF0YSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtUYWJsZUNvbHVtbn0gVGhlIHRhYmxlIGNvbHVtbiBkYXRhIGZvciB0aGlzIGNvbHVtbi4gVGhpcyBpcyB1c2VkIGZvciBhbHRlcmluZyB0YWJsZXMgYW5kIHN1Y2guXG4gICAqL1xuICBnZXRUYWJsZURhdGFDb2x1bW4oKSB7XG4gICAgcmV0dXJuIG5ldyBUYWJsZUNvbHVtbih0aGlzLmdldE5hbWUoKSwge1xuICAgICAgYXV0b0luY3JlbWVudDogdGhpcy5nZXRBdXRvSW5jcmVtZW50KCksXG4gICAgICBkZWZhdWx0OiB0aGlzLmdldERlZmF1bHQoKSxcbiAgICAgIGlzTmV3Q29sdW1uOiBmYWxzZSxcbiAgICAgIG1heExlbmd0aDogdGhpcy5nZXRNYXhMZW5ndGgoKSxcbiAgICAgIG5vdGVzOiB0aGlzLmdldE5vdGVzKCksXG4gICAgICBudWxsOiB0aGlzLmdldE51bGwoKSxcbiAgICAgIHByaW1hcnlLZXk6IHRoaXMuZ2V0UHJpbWFyeUtleSgpLFxuICAgICAgdHlwZTogdGhpcy5nZXRUeXBlKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUgaGludCBmcm9tIG5vdGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSB0eXBlIGhpbnQgZnJvbSBub3Rlcy5cbiAgICovXG4gIGdldFR5cGVIaW50RnJvbU5vdGVzKCkge1xuICAgIGNvbnN0IG5vdGVzID0gdGhpcy5nZXROb3RlcygpXG5cbiAgICBpZiAoIW5vdGVzIHx8IHR5cGVvZiBub3RlcyAhPSBcInN0cmluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IG1hdGNoID0gbm90ZXMubWF0Y2goL3ZlbG9jaW91czp0eXBlPShbYS16MC05Xy1dKykvaSlcblxuICAgIGlmICghbWF0Y2gpIHJldHVyblxuXG4gICAgcmV0dXJuIG1hdGNoWzFdLnRvTG93ZXJDYXNlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkYXRhYmFzZS1uYXRpdmUgdHlwZSBuYW1lIHVzZWQgaW4gU1FMIGNhc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlLW5hdGl2ZSB0eXBlIG5hbWUuXG4gICAqL1xuICBnZXREYXRhYmFzZVR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VHlwZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImdldFR5cGUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cbn1cbiJdfQ==