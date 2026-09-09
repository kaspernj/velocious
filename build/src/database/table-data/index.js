// @ts-check
import TableColumn from "./table-column.js";
import TableIndex from "./table-index.js";
import TableReference from "./table-reference.js";
/**
 * TableDataArgsType type.
 * @typedef {object} TableDataArgsType
 * @property {boolean} ifNotExists - Whether to create the table only if it does not exist.
 * @property {string} [primaryKeyType] - Default type for implicit primary-key references.
 */
export default class TableData {
    /**
     * Columns.
     * @type {TableColumn[]} */
    _columns = [];
    /**
     * Foreign keys.
     * @type {import("./table-foreign-key.js").default[]} */
    _foreignKeys = [];
    /**
     * Indexes.
     * @type {TableIndex[]} */
    _indexes = [];
    /**
     * References.
     * @type {TableReference[]} */
    _references = [];
    /**
     * Runs constructor.
     * @param {string} name - Name.
     * @param {TableDataArgsType} [args] - Options object.
     */
    constructor(name, args) {
        if (!name)
            throw new Error(`Invalid table name: ${name}`);
        this.args = args;
        this._name = name;
    }
    /**
     * Runs add column.
     * @param {string|TableColumn} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     */
    addColumn(name, args) {
        if (name instanceof TableColumn) {
            this.getColumns().push(name);
        }
        else {
            const column = new TableColumn(name, args);
            this.getColumns().push(column);
        }
    }
    /**
     * Runs get columns.
     * @returns {TableColumn[]} - The columns.
     */
    getColumns() { return this._columns; }
    /**
     * Runs add foreign key.
     * @param {import("./table-foreign-key.js").default} foreignKey - Foreign key.
     */
    addForeignKey(foreignKey) { this._foreignKeys.push(foreignKey); }
    /**
     * Runs get foreign keys.
     * @returns {import("./table-foreign-key.js").default[]} - The foreign keys.
     */
    getForeignKeys() { return this._foreignKeys; }
    /**
     * Runs add index.
     * @param {TableIndex} index - Index value.
     */
    addIndex(index) { this._indexes.push(index); }
    /**
     * Runs get indexes.
     * @returns {TableIndex[]} - The indexes.
     */
    getIndexes() { return this._indexes; }
    /**
     * Runs get name.
     * @returns {string} - The name.
     */
    getName() { return this._name; }
    /**
     * Runs set name.
     * @param {string} newName - New name.
     * @returns {void} - No return value.
     */
    setName(newName) { this._name = newName; }
    /**
     * Runs get if not exists.
     * @returns {boolean} - Whether if not exists.
     */
    getIfNotExists() { return this.args?.ifNotExists || false; }
    /**
     * Runs get references.
     * @returns {TableReference[]} - The references.
     */
    getReferences() { return this._references; }
    /**
     * Runs bigint.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    bigint(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "bigint" }, args)); }
    /**
     * Runs blob.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    blob(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "blob" }, args)); }
    /**
     * Runs boolean.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    boolean(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "boolean" }, args)); }
    /**
     * Runs datetime.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    datetime(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "datetime" }, args)); }
    /**
     * Runs decimal.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    decimal(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "decimal" }, args)); }
    /**
     * Runs integer.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    integer(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "integer" }, args)); }
    /**
     * Runs json.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    json(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "json" }, args)); }
    /**
     * Runs tinyint.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    tinyint(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "tinyint" }, args)); }
    /**
     * Runs references.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    references(name, args) {
        const columnName = `${name}_id`;
        const referenceArgs = args || {};
        const reference = new TableReference(name, referenceArgs);
        const { index, polymorphic, ...restArgs } = referenceArgs;
        const columnArgs = Object.assign({ isNewColumn: true, type: this.args?.primaryKeyType || "uuid" }, restArgs);
        const column = new TableColumn(columnName, columnArgs);
        const indexArgs = typeof index == "object" ? { unique: index.unique === true } : undefined;
        const tableIndex = new TableIndex([column], indexArgs);
        this.getColumns().push(column);
        this.getIndexes().push(tableIndex);
        this.getReferences().push(reference);
        if (polymorphic) {
            const typeColumnName = `${name}_type`;
            const typeColumn = new TableColumn(typeColumnName, { isNewColumn: true, type: "string" });
            this.getColumns().push(typeColumn);
        }
    }
    /**
     * Runs string.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    string(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "string" }, args)); }
    /**
     * Runs text.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    text(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "text" }, args)); }
    /**
     * Runs timestamps.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    timestamps(args) {
        this.datetime("created_at", args);
        this.datetime("updated_at", args);
    }
    /**
     * Runs uuid.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    uuid(name, args) { this.addColumn(name, Object.assign({ isNewColumn: true, type: "uuid" }, args)); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyxjQUFjLE1BQU0sc0JBQXNCLENBQUE7QUFFakQ7Ozs7O0dBS0c7QUFFSCxNQUFNLENBQUMsT0FBTyxPQUFPLFNBQVM7SUFDNUI7OytCQUUyQjtJQUMzQixRQUFRLEdBQUcsRUFBRSxDQUFBO0lBRWI7OzREQUV3RDtJQUN4RCxZQUFZLEdBQUcsRUFBRSxDQUFBO0lBRWpCOzs4QkFFMEI7SUFDMUIsUUFBUSxHQUFHLEVBQUUsQ0FBQTtJQUViOztrQ0FFOEI7SUFDOUIsV0FBVyxHQUFHLEVBQUUsQ0FBQTtJQUVoQjs7OztPQUlHO0lBQ0gsWUFBWSxJQUFJLEVBQUUsSUFBSTtRQUNwQixJQUFJLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLElBQUksRUFBRSxDQUFDLENBQUE7UUFFekQsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxTQUFTLENBQUMsSUFBSSxFQUFFLElBQUk7UUFDbEIsSUFBSSxJQUFJLFlBQVksV0FBVyxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QixDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sTUFBTSxHQUFHLElBQUksV0FBVyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUUxQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVSxLQUFLLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQSxDQUFDLENBQUM7SUFFckM7OztPQUdHO0lBQ0gsYUFBYSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFaEU7OztPQUdHO0lBQ0gsY0FBYyxLQUFLLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQSxDQUFDLENBQUM7SUFFN0M7OztPQUdHO0lBQ0gsUUFBUSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFN0M7OztPQUdHO0lBQ0gsVUFBVSxLQUFLLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQSxDQUFDLENBQUM7SUFFckM7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFL0I7Ozs7T0FJRztJQUNILE9BQU8sQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLEtBQUssR0FBRyxPQUFPLENBQUEsQ0FBQyxDQUFDO0lBRXpDOzs7T0FHRztJQUNILGNBQWMsS0FBSyxPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUUsV0FBVyxJQUFJLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFM0Q7OztPQUdHO0lBQ0gsYUFBYSxLQUFLLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQSxDQUFDLENBQUM7SUFFM0M7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFckc7Ozs7O09BS0c7SUFDSCxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFakc7Ozs7O09BS0c7SUFDSCxPQUFPLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFdkc7Ozs7O09BS0c7SUFDSCxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFekc7Ozs7O09BS0c7SUFDSCxPQUFPLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFdkc7Ozs7O09BS0c7SUFDSCxPQUFPLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFdkc7Ozs7O09BS0c7SUFDSCxJQUFJLENBQUMs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QUFRLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ2pDLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxDQUFBO0lBQ25DLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUNsRyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVGFibGVDb2x1bW4gZnJvbSBcIi4vdGFibGUtY29sdW1uLmpzXCJcbmltcG9ydCBUYWJsZUluZGV4IGZyb20gXCIuL3RhYmxlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZVJlZmVyZW5jZSBmcm9tIFwiLi90YWJsZS1yZWZlcmVuY2UuanNcIlxuXG4vKipcbiAqIFRhYmxlRGF0YUFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUYWJsZURhdGFBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBpZk5vdEV4aXN0cyAtIFdoZXRoZXIgdG8gY3JlYXRlIHRoZSB0YWJsZSBvbmx5IGlmIGl0IGRvZXMgbm90IGV4aXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtwcmltYXJ5S2V5VHlwZV0gLSBEZWZhdWx0IHR5cGUgZm9yIGltcGxpY2l0IHByaW1hcnkta2V5IHJlZmVyZW5jZXMuXG4gKi9cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGFibGVEYXRhIHtcbiAgLyoqXG4gICAqIENvbHVtbnMuXG4gICAqIEB0eXBlIHtUYWJsZUNvbHVtbltdfSAqL1xuICBfY29sdW1ucyA9IFtdXG5cbiAgLyoqXG4gICAqIEZvcmVpZ24ga2V5cy5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vdGFibGUtZm9yZWlnbi1rZXkuanNcIikuZGVmYXVsdFtdfSAqL1xuICBfZm9yZWlnbktleXMgPSBbXVxuXG4gIC8qKlxuICAgKiBJbmRleGVzLlxuICAgKiBAdHlwZSB7VGFibGVJbmRleFtdfSAqL1xuICBfaW5kZXhlcyA9IFtdXG5cbiAgLyoqXG4gICAqIFJlZmVyZW5jZXMuXG4gICAqIEB0eXBlIHtUYWJsZVJlZmVyZW5jZVtdfSAqL1xuICBfcmVmZXJlbmNlcyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtUYWJsZURhdGFBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihuYW1lLCBhcmdzKSB7XG4gICAgaWYgKCFuYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdGFibGUgbmFtZTogJHtuYW1lfWApXG5cbiAgICB0aGlzLmFyZ3MgPSBhcmdzXG4gICAgdGhpcy5fbmFtZSA9IG5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfFRhYmxlQ29sdW1ufSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICovXG4gIGFkZENvbHVtbihuYW1lLCBhcmdzKSB7XG4gICAgaWYgKG5hbWUgaW5zdGFuY2VvZiBUYWJsZUNvbHVtbikge1xuICAgICAgdGhpcy5nZXRDb2x1bW5zKCkucHVzaChuYW1lKVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBjb2x1bW4gPSBuZXcgVGFibGVDb2x1bW4obmFtZSwgYXJncylcblxuICAgICAgdGhpcy5nZXRDb2x1bW5zKCkucHVzaChjb2x1bW4pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtUYWJsZUNvbHVtbltdfSAtIFRoZSBjb2x1bW5zLlxuICAgKi9cbiAgZ2V0Q29sdW1ucygpIHsgcmV0dXJuIHRoaXMuX2NvbHVtbnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3RhYmxlLWZvcmVpZ24ta2V5LmpzXCIpLmRlZmF1bHR9IGZvcmVpZ25LZXkgLSBGb3JlaWduIGtleS5cbiAgICovXG4gIGFkZEZvcmVpZ25LZXkoZm9yZWlnbktleSkgeyB0aGlzLl9mb3JlaWduS2V5cy5wdXNoKGZvcmVpZ25LZXkpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZm9yZWlnbiBrZXlzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90YWJsZS1mb3JlaWduLWtleS5qc1wiKS5kZWZhdWx0W119IC0gVGhlIGZvcmVpZ24ga2V5cy5cbiAgICovXG4gIGdldEZvcmVpZ25LZXlzKCkgeyByZXR1cm4gdGhpcy5fZm9yZWlnbktleXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBpbmRleC5cbiAgICogQHBhcmFtIHtUYWJsZUluZGV4fSBpbmRleCAtIEluZGV4IHZhbHVlLlxuICAgKi9cbiAgYWRkSW5kZXgoaW5kZXgpIHsgdGhpcy5faW5kZXhlcy5wdXNoKGluZGV4KSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGluZGV4ZXMuXG4gICAqIEByZXR1cm5zIHtUYWJsZUluZGV4W119IC0gVGhlIGluZGV4ZXMuXG4gICAqL1xuICBnZXRJbmRleGVzKCkgeyByZXR1cm4gdGhpcy5faW5kZXhlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkgeyByZXR1cm4gdGhpcy5fbmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdOYW1lIC0gTmV3IG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE5hbWUobmV3TmFtZSkgeyB0aGlzLl9uYW1lID0gbmV3TmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGlmIG5vdCBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaWYgbm90IGV4aXN0cy5cbiAgICovXG4gIGdldElmTm90RXhpc3RzKCkgeyByZXR1cm4gdGhpcy5hcmdzPy5pZk5vdEV4aXN0cyB8fCBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlZmVyZW5jZXMuXG4gICAqIEByZXR1cm5zIHtUYWJsZVJlZmVyZW5jZVtdfSAtIFRoZSByZWZlcmVuY2VzLlxuICAgKi9cbiAgZ2V0UmVmZXJlbmNlcygpIHsgcmV0dXJuIHRoaXMuX3JlZmVyZW5jZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJpZ2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBiaWdpbnQobmFtZSwgYXJncykgeyB0aGlzLmFkZENvbHVtbihuYW1lLCBPYmplY3QuYXNzaWduKHtpc05ld0NvbHVtbjogdHJ1ZSwgdHlwZTogXCJiaWdpbnRcIn0sIGFyZ3MpKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmxvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBibG9iKG5hbWUsIGFyZ3MpIHsgdGhpcy5hZGRDb2x1bW4obmFtZSwgT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IFwiYmxvYlwifSwgYXJncykpIH1cblxuICAvKipcbiAgICogUnVucyBib29sZWFuLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90YWJsZS1jb2x1bW4uanNcIikuVGFibGVDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGJvb2xlYW4obmFtZSwgYXJncykgeyB0aGlzLmFkZENvbHVtbihuYW1lLCBPYmplY3QuYXNzaWduKHtpc05ld0NvbHVtbjogdHJ1ZSwgdHlwZTogXCJib29sZWFuXCJ9LCBhcmdzKSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRhdGV0aW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90YWJsZS1jb2x1bW4uanNcIikuVGFibGVDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGRhdGV0aW1lKG5hbWUsIGFyZ3MpIHsgdGhpcy5hZGRDb2x1bW4obmFtZSwgT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IFwiZGF0ZXRpbWVcIn0sIGFyZ3MpKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVjaW1hbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBkZWNpbWFsKG5hbWUsIGFyZ3MpIHsgdGhpcy5hZGRDb2x1bW4obmFtZSwgT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IFwiZGVjaW1hbFwifSwgYXJncykpIH1cblxuICAvKipcbiAgICogUnVucyBpbnRlZ2VyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90YWJsZS1jb2x1bW4uanNcIikuVGFibGVDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGludGVnZXIobmFtZSwgYXJncykgeyB0aGlzLmFkZENvbHVtbihuYW1lLCBPYmplY3QuYXNzaWduKHtpc05ld0NvbHVtbjogdHJ1ZSwgdHlwZTogXCJpbnRlZ2VyXCJ9LCBhcmdzKSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpzb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAganNvbihuYW1lLCBhcmdzKSB7IHRoaXMuYWRkQ29sdW1uKG5hbWUsIE9iamVjdC5hc3NpZ24oe2lzTmV3Q29sdW1uOiB0cnVlLCB0eXBlOiBcImpzb25cIn0sIGFyZ3MpKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGlueWludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0aW55aW50KG5hbWUsIGFyZ3MpIHsgdGhpcy5hZGRDb2x1bW4obmFtZSwgT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IFwidGlueWludFwifSwgYXJncykpIH1cblxuICAvKipcbiAgICogUnVucyByZWZlcmVuY2VzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90YWJsZS1jb2x1bW4uanNcIikuVGFibGVDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlZmVyZW5jZXMobmFtZSwgYXJncykge1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBgJHtuYW1lfV9pZGBcbiAgICBjb25zdCByZWZlcmVuY2VBcmdzID0gYXJncyB8fCB7fVxuICAgIGNvbnN0IHJlZmVyZW5jZSA9IG5ldyBUYWJsZVJlZmVyZW5jZShuYW1lLCByZWZlcmVuY2VBcmdzKVxuICAgIGNvbnN0IHtpbmRleCwgcG9seW1vcnBoaWMsIC4uLnJlc3RBcmdzfSA9IHJlZmVyZW5jZUFyZ3NcbiAgICBjb25zdCBjb2x1bW5BcmdzID0gT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IHRoaXMuYXJncz8ucHJpbWFyeUtleVR5cGUgfHwgXCJ1dWlkXCJ9LCByZXN0QXJncylcbiAgICBjb25zdCBjb2x1bW4gPSBuZXcgVGFibGVDb2x1bW4oY29sdW1uTmFtZSwgY29sdW1uQXJncylcbiAgICBjb25zdCBpbmRleEFyZ3MgPSB0eXBlb2YgaW5kZXggPT0gXCJvYmplY3RcIiA/IHt1bmlxdWU6IGluZGV4LnVuaXF1ZSA9PT0gdHJ1ZX0gOiB1bmRlZmluZWRcbiAgICBjb25zdCB0YWJsZUluZGV4ID0gbmV3IFRhYmxlSW5kZXgoW2NvbHVtbl0sIGluZGV4QXJncylcblxuICAgIHRoaXMuZ2V0Q29sdW1ucygpLnB1c2goY29sdW1uKVxuICAgIHRoaXMuZ2V0SW5kZXhlcygpLnB1c2godGFibGVJbmRleClcbiAgICB0aGlzLmdldFJlZmVyZW5jZXMoKS5wdXNoKHJlZmVyZW5jZSlcblxuICAgIGlmIChwb2x5bW9ycGhpYykge1xuICAgICAgY29uc3QgdHlwZUNvbHVtbk5hbWUgPSBgJHtuYW1lfV90eXBlYFxuICAgICAgY29uc3QgdHlwZUNvbHVtbiA9IG5ldyBUYWJsZUNvbHVtbih0eXBlQ29sdW1uTmFtZSwge2lzTmV3Q29sdW1uOiB0cnVlLCB0eXBlOiBcInN0cmluZ1wifSlcblxuICAgICAgdGhpcy5nZXRDb2x1bW5zKCkucHVzaCh0eXBlQ29sdW1uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0cmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdHJpbmcobmFtZSwgYXJncykgeyB0aGlzLmFkZENvbHVtbihuYW1lLCBPYmplY3QuYXNzaWduKHtpc05ld0NvbHVtbjogdHJ1ZSwgdHlwZTogXCJzdHJpbmdcIn0sIGFyZ3MpKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0ZXh0KG5hbWUsIGFyZ3MpIHsgdGhpcy5hZGRDb2x1bW4obmFtZSwgT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IFwidGV4dFwifSwgYXJncykpIH1cblxuICAvKipcbiAgICogUnVucyB0aW1lc3RhbXBzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0aW1lc3RhbXBzKGFyZ3MpIHtcbiAgICB0aGlzLmRhdGV0aW1lKFwiY3JlYXRlZF9hdFwiLCBhcmdzKVxuICAgIHRoaXMuZGF0ZXRpbWUoXCJ1cGRhdGVkX2F0XCIsIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1dWlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90YWJsZS1jb2x1bW4uanNcIikuVGFibGVDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHV1aWQobmFtZSwgYXJncykgeyB0aGlzLmFkZENvbHVtbihuYW1lLCBPYmplY3QuYXNzaWduKHtpc05ld0NvbHVtbjogdHJ1ZSwgdHlwZTogXCJ1dWlkXCJ9LCBhcmdzKSkgfVxufVxuIl19