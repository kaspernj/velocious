// @ts-check
/**
 * ChangeTableAddIndexArgsType type.
 * @typedef {object} ChangeTableAddIndexArgsType
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should be unique.
 */
/**
 * ChangeTableRemoveIndexArgsType type.
 * @typedef {object} ChangeTableRemoveIndexArgsType
 * @property {string} [name] - Explicit index name to remove.
 */
/**
 * ChangeTableRemoveReferenceArgsType type.
 * @typedef {object} ChangeTableRemoveReferenceArgsType
 * @property {string} [columnName] - Override the derived reference column name.
 * @property {string} [indexName] - Explicit generated index name to remove.
 */
/**
 * ChangeTableAddColumnOperationType type.
 * @typedef {object} ChangeTableAddColumnOperationType
 * @property {"addColumn"} type - Operation type.
 * @property {string} columnName - Column name.
 * @property {string} columnType - Column type.
 * @property {import("../table-data/table-column.js").TableColumnArgsType | undefined} args - Column args.
 */
/**
 * ChangeTableRemoveColumnOperationType type.
 * @typedef {object} ChangeTableRemoveColumnOperationType
 * @property {"removeColumn"} type - Operation type.
 * @property {string} columnName - Column name.
 */
/**
 * ChangeTableAddIndexOperationType type.
 * @typedef {object} ChangeTableAddIndexOperationType
 * @property {"addIndex"} type - Operation type.
 * @property {Array<string | import("../table-data/table-column.js").default>} columns - Columns to index.
 * @property {ChangeTableAddIndexArgsType | undefined} args - Index args.
 */
/**
 * ChangeTableRemoveIndexOperationType type.
 * @typedef {object} ChangeTableRemoveIndexOperationType
 * @property {"removeIndex"} type - Operation type.
 * @property {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
 * @property {ChangeTableRemoveIndexArgsType | undefined} args - Index args.
 */
/**
 * ChangeTableAddReferenceOperationType type.
 * @typedef {object} ChangeTableAddReferenceOperationType
 * @property {"addReference"} type - Operation type.
 * @property {string} referenceName - Reference name.
 * @property {object | undefined} args - Reference args.
 */
/**
 * ChangeTableRemoveReferenceOperationType type.
 * @typedef {object} ChangeTableRemoveReferenceOperationType
 * @property {"removeReference"} type - Operation type.
 * @property {string} referenceName - Reference name.
 * @property {ChangeTableRemoveReferenceArgsType | undefined} args - Reference args.
 */
/**
 * ChangeTableRenameColumnOperationType type.
 * @typedef {object} ChangeTableRenameColumnOperationType
 * @property {"renameColumn"} type - Operation type.
 * @property {string} oldColumnName - Previous column name.
 * @property {string} newColumnName - New column name.
 */
/**
 * ChangeTableChangeColumnNullOperationType type.
 * @typedef {object} ChangeTableChangeColumnNullOperationType
 * @property {"changeColumnNull"} type - Operation type.
 * @property {string} columnName - Column name.
 * @property {boolean} nullable - Whether the column becomes nullable.
 */
/**
 * ChangeTableOperationType type.
 * @typedef {ChangeTableAddColumnOperationType | ChangeTableRemoveColumnOperationType | ChangeTableAddIndexOperationType | ChangeTableRemoveIndexOperationType | ChangeTableAddReferenceOperationType | ChangeTableRemoveReferenceOperationType | ChangeTableRenameColumnOperationType | ChangeTableChangeColumnNullOperationType} ChangeTableOperationType
 */
/**
 * Table-scoped recorder used by `migration.changeTable`. Each call records a
 * single DDL operation synchronously; `changeTable` replays them after the
 * callback completes so a failed callback executes zero recorded DDL.
 */
export default class VelociousDatabaseMigrationChangeTable {
    /**
     * Operations.
     * @type {ChangeTableOperationType[]} */
    _operations = [];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.tableName - Table name.
     */
    constructor({ tableName }) {
        if (!tableName)
            throw new Error(`Invalid table name: ${tableName}`);
        this._tableName = tableName;
    }
    /**
     * Runs get table name.
     * @returns {string} - The table name.
     */
    getTableName() { return this._tableName; }
    /**
     * Runs get operations.
     * @returns {ChangeTableOperationType[]} - The recorded operations.
     */
    getOperations() { return this._operations; }
    /**
     * Records a new column.
     * @param {string} name - Column name.
     * @param {string} type - Column type.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    column(name, type, args) {
        this._operations.push({ type: "addColumn", columnName: name, columnType: type, args });
    }
    /**
     * Records a bigint column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    bigint(name, args) { this.column(name, "bigint", args); }
    /**
     * Records a blob column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    blob(name, args) { this.column(name, "blob", args); }
    /**
     * Records a boolean column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    boolean(name, args) { this.column(name, "boolean", args); }
    /**
     * Records a datetime column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    datetime(name, args) { this.column(name, "datetime", args); }
    /**
     * Records a decimal column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    decimal(name, args) { this.column(name, "decimal", args); }
    /**
     * Records an integer column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    integer(name, args) { this.column(name, "integer", args); }
    /**
     * Records a json column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    json(name, args) { this.column(name, "json", args); }
    /**
     * Records a string column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    string(name, args) { this.column(name, "string", args); }
    /**
     * Records a text column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    text(name, args) { this.column(name, "text", args); }
    /**
     * Records a tinyint column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    tinyint(name, args) { this.column(name, "tinyint", args); }
    /**
     * Records a uuid column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    uuid(name, args) { this.column(name, "uuid", args); }
    /**
     * Records created_at and updated_at datetime columns.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    timestamps(args) {
        this.datetime("created_at", args);
        this.datetime("updated_at", args);
    }
    /**
     * Records a new index.
     * @param {string | Array<string | import("../table-data/table-column.js").default>} columns - Column name or array of column names.
     * @param {ChangeTableAddIndexArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    index(columns, args) {
        const normalizedColumns = typeof columns == "string" ? [columns] : columns;
        this._operations.push({ type: "addIndex", columns: normalizedColumns, args });
    }
    /**
     * Records a reference column, index, and optional foreign key.
     * @param {string} name - Reference name.
     * @param {object} [args] - Options object.
     * @returns {void} - No return value.
     */
    references(name, args) {
        this._operations.push({ type: "addReference", referenceName: name, args });
    }
    /**
     * Alias for {@link references}.
     * @param {string} name - Reference name.
     * @param {object} [args] - Options object.
     * @returns {void} - No return value.
     */
    belongsTo(name, args) { this.references(name, args); }
    /**
     * Records removal of one or more columns.
     * @param {string[]} columnNames - Column names to remove.
     * @returns {void} - No return value.
     */
    remove(...columnNames) {
        for (const columnName of columnNames) {
            this._operations.push({ type: "removeColumn", columnName });
        }
    }
    /**
     * Records removal of an index.
     * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
     * @param {ChangeTableRemoveIndexArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    removeIndex(nameOrColumns, args) {
        this._operations.push({ type: "removeIndex", nameOrColumns, args });
    }
    /**
     * Records removal of a reference column and its generated index and foreign keys.
     * @param {string} name - Reference name.
     * @param {ChangeTableRemoveReferenceArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    removeReferences(name, args) {
        this._operations.push({ type: "removeReference", referenceName: name, args });
    }
    /**
     * Records removal of the created_at and updated_at columns.
     * @returns {void} - No return value.
     */
    removeTimestamps() {
        this.remove("created_at", "updated_at");
    }
    /**
     * Records a column rename.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {void} - No return value.
     */
    rename(oldColumnName, newColumnName) {
        this._operations.push({ type: "renameColumn", oldColumnName, newColumnName });
    }
    /**
     * Records a change to a column's nullability.
     * @param {string} columnName - Column name.
     * @param {boolean} nullable - Whether the column becomes nullable.
     * @returns {void} - No return value.
     */
    changeNull(columnName, nullable) {
        this._operations.push({ type: "changeColumnNull", columnName, nullable });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhbmdlLXRhYmxlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL21pZ3JhdGlvbi9jaGFuZ2UtdGFibGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7R0FNRztBQUVIOzs7O0dBSUc7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7R0FHRztBQUVIOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHFDQUFxQztJQUN4RDs7NENBRXdDO0lBQ3hDLFdBQVcsR0FBRyxFQUFFLENBQUE7SUFFaEI7Ozs7T0FJRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUM7UUFDckIsSUFBSSxDQUFDLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixTQUFTLEVBQUUsQ0FBQyxDQUFBO1FBRW5FLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxZQUFZLEtBQUssT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFBLENBQUMsQ0FBQztJQUV6Qzs7O09BR0c7SUFDSCxhQUFhLEtBQUssT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBLENBQUMsQ0FBQztJQUUzQzs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJO1FBQ3JCLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUN0RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXhEOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7Ozs7T0FLRztJQUNILE9BQU8sQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFMUQ7Ozs7O09BS0c7SUFDSCxRQUFRLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTVEOzs7OztPQUtHO0lBQ0gsT0FBTyxDQUFDLElBQUksRUFBRSxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUxRDs7Ozs7T0FLRztJQUNILE9BQU8sQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFMUQ7Ozs7O09BS0c7SUFDSCxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7OztPQUtHO0lBQ0gsTUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FB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QUksQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQTtJQUN6RSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBDaGFuZ2VUYWJsZUFkZEluZGV4QXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENoYW5nZVRhYmxlQWRkSW5kZXhBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbaWZOb3RFeGlzdHNdIC0gU2tpcCBjcmVhdGlvbiBpZiB0aGUgaW5kZXggYWxyZWFkeSBleGlzdHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gRXhwbGljaXQgaW5kZXggbmFtZSB0byB1c2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFt1bmlxdWVdIC0gV2hldGhlciB0aGUgaW5kZXggc2hvdWxkIGJlIHVuaXF1ZS5cbiAqL1xuXG4vKipcbiAqIENoYW5nZVRhYmxlUmVtb3ZlSW5kZXhBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ2hhbmdlVGFibGVSZW1vdmVJbmRleEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gRXhwbGljaXQgaW5kZXggbmFtZSB0byByZW1vdmUuXG4gKi9cblxuLyoqXG4gKiBDaGFuZ2VUYWJsZVJlbW92ZVJlZmVyZW5jZUFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDaGFuZ2VUYWJsZVJlbW92ZVJlZmVyZW5jZUFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbHVtbk5hbWVdIC0gT3ZlcnJpZGUgdGhlIGRlcml2ZWQgcmVmZXJlbmNlIGNvbHVtbiBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtpbmRleE5hbWVdIC0gRXhwbGljaXQgZ2VuZXJhdGVkIGluZGV4IG5hbWUgdG8gcmVtb3ZlLlxuICovXG5cbi8qKlxuICogQ2hhbmdlVGFibGVBZGRDb2x1bW5PcGVyYXRpb25UeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDaGFuZ2VUYWJsZUFkZENvbHVtbk9wZXJhdGlvblR5cGVcbiAqIEBwcm9wZXJ0eSB7XCJhZGRDb2x1bW5cIn0gdHlwZSAtIE9wZXJhdGlvbiB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGUgfCB1bmRlZmluZWR9IGFyZ3MgLSBDb2x1bW4gYXJncy5cbiAqL1xuXG4vKipcbiAqIENoYW5nZVRhYmxlUmVtb3ZlQ29sdW1uT3BlcmF0aW9uVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ2hhbmdlVGFibGVSZW1vdmVDb2x1bW5PcGVyYXRpb25UeXBlXG4gKiBAcHJvcGVydHkge1wicmVtb3ZlQ29sdW1uXCJ9IHR5cGUgLSBPcGVyYXRpb24gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gKi9cblxuLyoqXG4gKiBDaGFuZ2VUYWJsZUFkZEluZGV4T3BlcmF0aW9uVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ2hhbmdlVGFibGVBZGRJbmRleE9wZXJhdGlvblR5cGVcbiAqIEBwcm9wZXJ0eSB7XCJhZGRJbmRleFwifSB0eXBlIC0gT3BlcmF0aW9uIHR5cGUuXG4gKiBAcHJvcGVydHkge0FycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSBjb2x1bW5zIC0gQ29sdW1ucyB0byBpbmRleC5cbiAqIEBwcm9wZXJ0eSB7Q2hhbmdlVGFibGVBZGRJbmRleEFyZ3NUeXBlIHwgdW5kZWZpbmVkfSBhcmdzIC0gSW5kZXggYXJncy5cbiAqL1xuXG4vKipcbiAqIENoYW5nZVRhYmxlUmVtb3ZlSW5kZXhPcGVyYXRpb25UeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDaGFuZ2VUYWJsZVJlbW92ZUluZGV4T3BlcmF0aW9uVHlwZVxuICogQHByb3BlcnR5IHtcInJlbW92ZUluZGV4XCJ9IHR5cGUgLSBPcGVyYXRpb24gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IG5hbWVPckNvbHVtbnMgLSBJbmRleCBuYW1lIG9yIGNvbHVtbnMuXG4gKiBAcHJvcGVydHkge0NoYW5nZVRhYmxlUmVtb3ZlSW5kZXhBcmdzVHlwZSB8IHVuZGVmaW5lZH0gYXJncyAtIEluZGV4IGFyZ3MuXG4gKi9cblxuLyoqXG4gKiBDaGFuZ2VUYWJsZUFkZFJlZmVyZW5jZU9wZXJhdGlvblR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENoYW5nZVRhYmxlQWRkUmVmZXJlbmNlT3BlcmF0aW9uVHlwZVxuICogQHByb3BlcnR5IHtcImFkZFJlZmVyZW5jZVwifSB0eXBlIC0gT3BlcmF0aW9uIHR5cGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVmZXJlbmNlTmFtZSAtIFJlZmVyZW5jZSBuYW1lLlxuICogQHByb3BlcnR5IHtvYmplY3QgfCB1bmRlZmluZWR9IGFyZ3MgLSBSZWZlcmVuY2UgYXJncy5cbiAqL1xuXG4vKipcbiAqIENoYW5nZVRhYmxlUmVtb3ZlUmVmZXJlbmNlT3BlcmF0aW9uVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ2hhbmdlVGFibGVSZW1vdmVSZWZlcmVuY2VPcGVyYXRpb25UeXBlXG4gKiBAcHJvcGVydHkge1wicmVtb3ZlUmVmZXJlbmNlXCJ9IHR5cGUgLSBPcGVyYXRpb24gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZWZlcmVuY2VOYW1lIC0gUmVmZXJlbmNlIG5hbWUuXG4gKiBAcHJvcGVydHkge0NoYW5nZVRhYmxlUmVtb3ZlUmVmZXJlbmNlQXJnc1R5cGUgfCB1bmRlZmluZWR9IGFyZ3MgLSBSZWZlcmVuY2UgYXJncy5cbiAqL1xuXG4vKipcbiAqIENoYW5nZVRhYmxlUmVuYW1lQ29sdW1uT3BlcmF0aW9uVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ2hhbmdlVGFibGVSZW5hbWVDb2x1bW5PcGVyYXRpb25UeXBlXG4gKiBAcHJvcGVydHkge1wicmVuYW1lQ29sdW1uXCJ9IHR5cGUgLSBPcGVyYXRpb24gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBvbGRDb2x1bW5OYW1lIC0gUHJldmlvdXMgY29sdW1uIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbmV3Q29sdW1uTmFtZSAtIE5ldyBjb2x1bW4gbmFtZS5cbiAqL1xuXG4vKipcbiAqIENoYW5nZVRhYmxlQ2hhbmdlQ29sdW1uTnVsbE9wZXJhdGlvblR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENoYW5nZVRhYmxlQ2hhbmdlQ29sdW1uTnVsbE9wZXJhdGlvblR5cGVcbiAqIEBwcm9wZXJ0eSB7XCJjaGFuZ2VDb2x1bW5OdWxsXCJ9IHR5cGUgLSBPcGVyYXRpb24gdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IG51bGxhYmxlIC0gV2hldGhlciB0aGUgY29sdW1uIGJlY29tZXMgbnVsbGFibGUuXG4gKi9cblxuLyoqXG4gKiBDaGFuZ2VUYWJsZU9wZXJhdGlvblR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtDaGFuZ2VUYWJsZUFkZENvbHVtbk9wZXJhdGlvblR5cGUgfCBDaGFuZ2VUYWJsZVJlbW92ZUNvbHVtbk9wZXJhdGlvblR5cGUgfCBDaGFuZ2VUYWJsZUFkZEluZGV4T3BlcmF0aW9uVHlwZSB8IENoYW5nZVRhYmxlUmVtb3ZlSW5kZXhPcGVyYXRpb25UeXBlIHwgQ2hhbmdlVGFibGVBZGRSZWZlcmVuY2VPcGVyYXRpb25UeXBlIHwgQ2hhbmdlVGFibGVSZW1vdmVSZWZlcmVuY2VPcGVyYXRpb25UeXBlIHwgQ2hhbmdlVGFibGVSZW5hbWVDb2x1bW5PcGVyYXRpb25UeXBlIHwgQ2hhbmdlVGFibGVDaGFuZ2VDb2x1bW5OdWxsT3BlcmF0aW9uVHlwZX0gQ2hhbmdlVGFibGVPcGVyYXRpb25UeXBlXG4gKi9cblxuLyoqXG4gKiBUYWJsZS1zY29wZWQgcmVjb3JkZXIgdXNlZCBieSBgbWlncmF0aW9uLmNoYW5nZVRhYmxlYC4gRWFjaCBjYWxsIHJlY29yZHMgYVxuICogc2luZ2xlIERETCBvcGVyYXRpb24gc3luY2hyb25vdXNseTsgYGNoYW5nZVRhYmxlYCByZXBsYXlzIHRoZW0gYWZ0ZXIgdGhlXG4gKiBjYWxsYmFjayBjb21wbGV0ZXMgc28gYSBmYWlsZWQgY2FsbGJhY2sgZXhlY3V0ZXMgemVybyByZWNvcmRlZCBEREwuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlTWlncmF0aW9uQ2hhbmdlVGFibGUge1xuICAvKipcbiAgICogT3BlcmF0aW9ucy5cbiAgICogQHR5cGUge0NoYW5nZVRhYmxlT3BlcmF0aW9uVHlwZVtdfSAqL1xuICBfb3BlcmF0aW9ucyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7dGFibGVOYW1lfSkge1xuICAgIGlmICghdGFibGVOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdGFibGUgbmFtZTogJHt0YWJsZU5hbWV9YClcblxuICAgIHRoaXMuX3RhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBnZXRUYWJsZU5hbWUoKSB7IHJldHVybiB0aGlzLl90YWJsZU5hbWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcGVyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7Q2hhbmdlVGFibGVPcGVyYXRpb25UeXBlW119IC0gVGhlIHJlY29yZGVkIG9wZXJhdGlvbnMuXG4gICAqL1xuICBnZXRPcGVyYXRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3BlcmF0aW9ucyB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBuZXcgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjb2x1bW4obmFtZSwgdHlwZSwgYXJncykge1xuICAgIHRoaXMuX29wZXJhdGlvbnMucHVzaCh7dHlwZTogXCJhZGRDb2x1bW5cIiwgY29sdW1uTmFtZTogbmFtZSwgY29sdW1uVHlwZTogdHlwZSwgYXJnc30pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGJpZ2ludCBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuVGFibGVDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGJpZ2ludChuYW1lLCBhcmdzKSB7IHRoaXMuY29sdW1uKG5hbWUsIFwiYmlnaW50XCIsIGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGJsb2IgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBibG9iKG5hbWUsIGFyZ3MpIHsgdGhpcy5jb2x1bW4obmFtZSwgXCJibG9iXCIsIGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGJvb2xlYW4gY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBib29sZWFuKG5hbWUsIGFyZ3MpIHsgdGhpcy5jb2x1bW4obmFtZSwgXCJib29sZWFuXCIsIGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGRhdGV0aW1lIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgZGF0ZXRpbWUobmFtZSwgYXJncykgeyB0aGlzLmNvbHVtbihuYW1lLCBcImRhdGV0aW1lXCIsIGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGRlY2ltYWwgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBkZWNpbWFsKG5hbWUsIGFyZ3MpIHsgdGhpcy5jb2x1bW4obmFtZSwgXCJkZWNpbWFsXCIsIGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbiBpbnRlZ2VyIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgaW50ZWdlcihuYW1lLCBhcmdzKSB7IHRoaXMuY29sdW1uKG5hbWUsIFwiaW50ZWdlclwiLCBhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBqc29uIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAganNvbihuYW1lLCBhcmdzKSB7IHRoaXMuY29sdW1uKG5hbWUsIFwianNvblwiLCBhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBzdHJpbmcgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdHJpbmcobmFtZSwgYXJncykgeyB0aGlzLmNvbHVtbihuYW1lLCBcInN0cmluZ1wiLCBhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB0ZXh0IGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdGV4dChuYW1lLCBhcmdzKSB7IHRoaXMuY29sdW1uKG5hbWUsIFwidGV4dFwiLCBhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB0aW55aW50IGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdGlueWludChuYW1lLCBhcmdzKSB7IHRoaXMuY29sdW1uKG5hbWUsIFwidGlueWludFwiLCBhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB1dWlkIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgdXVpZChuYW1lLCBhcmdzKSB7IHRoaXMuY29sdW1uKG5hbWUsIFwidXVpZFwiLCBhcmdzKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgY3JlYXRlZF9hdCBhbmQgdXBkYXRlZF9hdCBkYXRldGltZSBjb2x1bW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLlRhYmxlQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICB0aW1lc3RhbXBzKGFyZ3MpIHtcbiAgICB0aGlzLmRhdGV0aW1lKFwiY3JlYXRlZF9hdFwiLCBhcmdzKVxuICAgIHRoaXMuZGF0ZXRpbWUoXCJ1cGRhdGVkX2F0XCIsIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIG5ldyBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gY29sdW1ucyAtIENvbHVtbiBuYW1lIG9yIGFycmF5IG9mIGNvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtDaGFuZ2VUYWJsZUFkZEluZGV4QXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBpbmRleChjb2x1bW5zLCBhcmdzKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbHVtbnMgPSB0eXBlb2YgY29sdW1ucyA9PSBcInN0cmluZ1wiID8gW2NvbHVtbnNdIDogY29sdW1uc1xuXG4gICAgdGhpcy5fb3BlcmF0aW9ucy5wdXNoKHt0eXBlOiBcImFkZEluZGV4XCIsIGNvbHVtbnM6IG5vcm1hbGl6ZWRDb2x1bW5zLCBhcmdzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcmVmZXJlbmNlIGNvbHVtbiwgaW5kZXgsIGFuZCBvcHRpb25hbCBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBSZWZlcmVuY2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWZlcmVuY2VzKG5hbWUsIGFyZ3MpIHtcbiAgICB0aGlzLl9vcGVyYXRpb25zLnB1c2goe3R5cGU6IFwiYWRkUmVmZXJlbmNlXCIsIHJlZmVyZW5jZU5hbWU6IG5hbWUsIGFyZ3N9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFsaWFzIGZvciB7QGxpbmsgcmVmZXJlbmNlc30uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUmVmZXJlbmNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYmVsb25nc1RvKG5hbWUsIGFyZ3MpIHsgdGhpcy5yZWZlcmVuY2VzKG5hbWUsIGFyZ3MpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyByZW1vdmFsIG9mIG9uZSBvciBtb3JlIGNvbHVtbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGNvbHVtbk5hbWVzIC0gQ29sdW1uIG5hbWVzIHRvIHJlbW92ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVtb3ZlKC4uLmNvbHVtbk5hbWVzKSB7XG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIGNvbHVtbk5hbWVzKSB7XG4gICAgICB0aGlzLl9vcGVyYXRpb25zLnB1c2goe3R5cGU6IFwicmVtb3ZlQ29sdW1uXCIsIGNvbHVtbk5hbWV9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHJlbW92YWwgb2YgYW4gaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IG5hbWVPckNvbHVtbnMgLSBJbmRleCBuYW1lIG9yIGNvbHVtbnMuXG4gICAqIEBwYXJhbSB7Q2hhbmdlVGFibGVSZW1vdmVJbmRleEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVtb3ZlSW5kZXgobmFtZU9yQ29sdW1ucywgYXJncykge1xuICAgIHRoaXMuX29wZXJhdGlvbnMucHVzaCh7dHlwZTogXCJyZW1vdmVJbmRleFwiLCBuYW1lT3JDb2x1bW5zLCBhcmdzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHJlbW92YWwgb2YgYSByZWZlcmVuY2UgY29sdW1uIGFuZCBpdHMgZ2VuZXJhdGVkIGluZGV4IGFuZCBmb3JlaWduIGtleXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUmVmZXJlbmNlIG5hbWUuXG4gICAqIEBwYXJhbSB7Q2hhbmdlVGFibGVSZW1vdmVSZWZlcmVuY2VBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlbW92ZVJlZmVyZW5jZXMobmFtZSwgYXJncykge1xuICAgIHRoaXMuX29wZXJhdGlvbnMucHVzaCh7dHlwZTogXCJyZW1vdmVSZWZlcmVuY2VcIiwgcmVmZXJlbmNlTmFtZTogbmFtZSwgYXJnc30pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyByZW1vdmFsIG9mIHRoZSBjcmVhdGVkX2F0IGFuZCB1cGRhdGVkX2F0IGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlbW92ZVRpbWVzdGFtcHMoKSB7XG4gICAgdGhpcy5yZW1vdmUoXCJjcmVhdGVkX2F0XCIsIFwidXBkYXRlZF9hdFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBjb2x1bW4gcmVuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkQ29sdW1uTmFtZSAtIFByZXZpb3VzIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3Q29sdW1uTmFtZSAtIE5ldyBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVuYW1lKG9sZENvbHVtbk5hbWUsIG5ld0NvbHVtbk5hbWUpIHtcbiAgICB0aGlzLl9vcGVyYXRpb25zLnB1c2goe3R5cGU6IFwicmVuYW1lQ29sdW1uXCIsIG9sZENvbHVtbk5hbWUsIG5ld0NvbHVtbk5hbWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBjaGFuZ2UgdG8gYSBjb2x1bW4ncyBudWxsYWJpbGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBudWxsYWJsZSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBiZWNvbWVzIG51bGxhYmxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjaGFuZ2VOdWxsKGNvbHVtbk5hbWUsIG51bGxhYmxlKSB7XG4gICAgdGhpcy5fb3BlcmF0aW9ucy5wdXNoKHt0eXBlOiBcImNoYW5nZUNvbHVtbk51bGxcIiwgY29sdW1uTmFtZSwgbnVsbGFibGV9KVxuICB9XG59XG4iXX0=