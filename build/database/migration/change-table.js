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
  _operations = []

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {string} args.tableName - Table name.
   */
  constructor({tableName}) {
    if (!tableName) throw new Error(`Invalid table name: ${tableName}`)

    this._tableName = tableName
  }

  /**
   * Runs get table name.
   * @returns {string} - The table name.
   */
  getTableName() { return this._tableName }

  /**
   * Runs get operations.
   * @returns {ChangeTableOperationType[]} - The recorded operations.
   */
  getOperations() { return this._operations }

  /**
   * Records a new column.
   * @param {string} name - Column name.
   * @param {string} type - Column type.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  column(name, type, args) {
    this._operations.push({type: "addColumn", columnName: name, columnType: type, args})
  }

  /**
   * Records a bigint column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  bigint(name, args) { this.column(name, "bigint", args) }

  /**
   * Records a blob column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  blob(name, args) { this.column(name, "blob", args) }

  /**
   * Records a boolean column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  boolean(name, args) { this.column(name, "boolean", args) }

  /**
   * Records a datetime column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  datetime(name, args) { this.column(name, "datetime", args) }

  /**
   * Records a decimal column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  decimal(name, args) { this.column(name, "decimal", args) }

  /**
   * Records an integer column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  integer(name, args) { this.column(name, "integer", args) }

  /**
   * Records a json column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  json(name, args) { this.column(name, "json", args) }

  /**
   * Records a string column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  string(name, args) { this.column(name, "string", args) }

  /**
   * Records a text column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  text(name, args) { this.column(name, "text", args) }

  /**
   * Records a tinyint column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  tinyint(name, args) { this.column(name, "tinyint", args) }

  /**
   * Records a uuid column.
   * @param {string} name - Column name.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  uuid(name, args) { this.column(name, "uuid", args) }

  /**
   * Records created_at and updated_at datetime columns.
   * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  timestamps(args) {
    this.datetime("created_at", args)
    this.datetime("updated_at", args)
  }

  /**
   * Records a new index.
   * @param {string | Array<string | import("../table-data/table-column.js").default>} columns - Column name or array of column names.
   * @param {ChangeTableAddIndexArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  index(columns, args) {
    const normalizedColumns = typeof columns == "string" ? [columns] : columns

    this._operations.push({type: "addIndex", columns: normalizedColumns, args})
  }

  /**
   * Records a reference column, index, and optional foreign key.
   * @param {string} name - Reference name.
   * @param {object} [args] - Options object.
   * @returns {void} - No return value.
   */
  references(name, args) {
    this._operations.push({type: "addReference", referenceName: name, args})
  }

  /**
   * Alias for {@link references}.
   * @param {string} name - Reference name.
   * @param {object} [args] - Options object.
   * @returns {void} - No return value.
   */
  belongsTo(name, args) { this.references(name, args) }

  /**
   * Records removal of one or more columns.
   * @param {string[]} columnNames - Column names to remove.
   * @returns {void} - No return value.
   */
  remove(...columnNames) {
    for (const columnName of columnNames) {
      this._operations.push({type: "removeColumn", columnName})
    }
  }

  /**
   * Records removal of an index.
   * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
   * @param {ChangeTableRemoveIndexArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  removeIndex(nameOrColumns, args) {
    this._operations.push({type: "removeIndex", nameOrColumns, args})
  }

  /**
   * Records removal of a reference column and its generated index and foreign keys.
   * @param {string} name - Reference name.
   * @param {ChangeTableRemoveReferenceArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  removeReferences(name, args) {
    this._operations.push({type: "removeReference", referenceName: name, args})
  }

  /**
   * Records removal of the created_at and updated_at columns.
   * @returns {void} - No return value.
   */
  removeTimestamps() {
    this.remove("created_at", "updated_at")
  }

  /**
   * Records a column rename.
   * @param {string} oldColumnName - Previous column name.
   * @param {string} newColumnName - New column name.
   * @returns {void} - No return value.
   */
  rename(oldColumnName, newColumnName) {
    this._operations.push({type: "renameColumn", oldColumnName, newColumnName})
  }

  /**
   * Records a change to a column's nullability.
   * @param {string} columnName - Column name.
   * @param {boolean} nullable - Whether the column becomes nullable.
   * @returns {void} - No return value.
   */
  changeNull(columnName, nullable) {
    this._operations.push({type: "changeColumnNull", columnName, nullable})
  }
}
