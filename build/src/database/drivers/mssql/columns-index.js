// @ts-check
import BaseColumnsIndex from "../base-columns-index.js";
import TableIndex from "../../table-data/table-index.js";
/**
 * MssqlColumnsIndexDataType type.
 * @typedef {object} MssqlColumnsIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */
export default class VelociousDatabaseDriversMssqlColumnsIndex extends BaseColumnsIndex {
    /**
     * Runs constructor.
     * @param {import("../base-table.js").default} table - Table.
     * @param {MssqlColumnsIndexDataType} data - Grouped index metadata.
     */
    constructor(table, data) {
        super(table, data);
        this.indexData = data;
    }
    /**
     * Runs get column names.
     * @returns {string[]} - Ordered index column names.
     */
    getColumnNames() { return this.indexData.columnNames; }
    /**
     * Runs get table data index.
     * @returns {TableIndex} - Table-data index.
     */
    getTableDataIndex() {
        return new TableIndex(this.getColumnNames(), {
            name: this.getName(),
            unique: this.isUnique()
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29sdW1ucy1pbmRleC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL21zc3FsL2NvbHVtbnMtaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0sMEJBQTBCLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0saUNBQWlDLENBQUE7QUFFeEQ7Ozs7Ozs7O0dBUUc7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLHlDQUEwQyxTQUFRLGdCQUFnQjtJQUNyRjs7OztPQUlHO0lBQ0gsWUFBWSxLQUFLLEVBQUUsSUFBSTtRQUNyQixLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ2xCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjLEtBQUssT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQSxDQUFDLENBQUM7SUFFdEQ7OztPQUdHO0lBQ0gsaUJBQWlCO1FBQ2YsT0FBTyxJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLEVBQUU7WUFDM0MsSUFBSSxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDcEIsTUFBTSxFQUFFLElBQUksQ0FBQyxRQUFRLEVBQUU7U0FDeEIsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlQ29sdW1uc0luZGV4IGZyb20gXCIuLi9iYXNlLWNvbHVtbnMtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlSW5kZXggZnJvbSBcIi4uLy4uL3RhYmxlLWRhdGEvdGFibGUtaW5kZXguanNcIlxuXG4vKipcbiAqIE1zc3FsQ29sdW1uc0luZGV4RGF0YVR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IE1zc3FsQ29sdW1uc0luZGV4RGF0YVR5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGNvbHVtbk5hbWVzIC0gT3JkZXJlZCBpbmRleCBjb2x1bW4gbmFtZXMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaW5kZXhfbmFtZSAtIEluZGV4IG5hbWUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzX3ByaW1hcnlfa2V5IC0gV2hldGhlciB0aGUgaW5kZXggaXMgcHJpbWFyeS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNfdW5pcXVlIC0gV2hldGhlciB0aGUgaW5kZXggaXMgdW5pcXVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlX25hbWUgLSBUYWJsZSBuYW1lLlxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc01zc3FsQ29sdW1uc0luZGV4IGV4dGVuZHMgQmFzZUNvbHVtbnNJbmRleCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gdGFibGUgLSBUYWJsZS5cbiAgICogQHBhcmFtIHtNc3NxbENvbHVtbnNJbmRleERhdGFUeXBlfSBkYXRhIC0gR3JvdXBlZCBpbmRleCBtZXRhZGF0YS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHRhYmxlLCBkYXRhKSB7XG4gICAgc3VwZXIodGFibGUsIGRhdGEpXG4gICAgdGhpcy5pbmRleERhdGEgPSBkYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1uIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gT3JkZXJlZCBpbmRleCBjb2x1bW4gbmFtZXMuXG4gICAqL1xuICBnZXRDb2x1bW5OYW1lcygpIHsgcmV0dXJuIHRoaXMuaW5kZXhEYXRhLmNvbHVtbk5hbWVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgZGF0YSBpbmRleC5cbiAgICogQHJldHVybnMge1RhYmxlSW5kZXh9IC0gVGFibGUtZGF0YSBpbmRleC5cbiAgICovXG4gIGdldFRhYmxlRGF0YUluZGV4KCkge1xuICAgIHJldHVybiBuZXcgVGFibGVJbmRleCh0aGlzLmdldENvbHVtbk5hbWVzKCksIHtcbiAgICAgIG5hbWU6IHRoaXMuZ2V0TmFtZSgpLFxuICAgICAgdW5pcXVlOiB0aGlzLmlzVW5pcXVlKClcbiAgICB9KVxuICB9XG59XG4iXX0=