// @ts-check

import TableColumn from "./table-column.js"
import TableIndex from "./table-index.js"
import TableReference from "./table-reference.js"

/**
 * TableDataArgsType type.
 * @typedef {object} TableDataArgsType
 * @property {boolean} ifNotExists - Whether to create the table only if it does not exist.
 */

export default class TableData {
  /**
   * Columns.
   * @type {TableColumn[]} */
  _columns = []

  /**
   * Foreign keys.
   * @type {import("./table-foreign-key.js").default[]} */
  _foreignKeys = []

  /**
   * Indexes.
   * @type {TableIndex[]} */
  _indexes = []

  /**
   * References.
   * @type {TableReference[]} */
  _references = []

  /**
   * Runs constructor.
   * @param {string} name - Name.
   * @param {TableDataArgsType} [args] - Options object.
   */
  constructor(name, args) {
    if (!name) throw new Error(`Invalid table name: ${name}`)

    this.args = args
    this._name = name
  }

  /**
   * Runs add column.
   * @param {string|TableColumn} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   */
  addColumn(name, args) {
    if (name instanceof TableColumn) {
      this.getColumns().push(name)
    } else {
      const column = new TableColumn(name, args)

      this.getColumns().push(column)
    }
  }

  /**
   * Runs get columns.
   * @returns {TableColumn[]} - The columns.
   */
  getColumns() { return this._columns }

  /**
   * Runs add foreign key.
   * @param {import("./table-foreign-key.js").default} foreignKey - Foreign key.
   */
  addForeignKey(foreignKey) { this._foreignKeys.push(foreignKey) }

  /**
   * Runs get foreign keys.
   * @returns {import("./table-foreign-key.js").default[]} - The foreign keys.
   */
  getForeignKeys() { return this._foreignKeys }

  /**
   * Runs add index.
   * @param {TableIndex} index - Index value.
   */
  addIndex(index) { this._indexes.push(index) }

  /**
   * Runs get indexes.
   * @returns {TableIndex[]} - The indexes.
   */
  getIndexes() { return this._indexes }

  /**
   * Runs get name.
   * @returns {string} - The name.
   */
  getName() { return this._name }

  /**
   * Runs set name.
   * @param {string} newName - New name.
   * @returns {void} - No return value.
   */
  setName(newName) { this._name = newName }

  /**
   * Runs get if not exists.
   * @returns {boolean} - Whether if not exists.
   */
  getIfNotExists() { return this.args?.ifNotExists || false }

  /**
   * Runs get references.
   * @returns {TableReference[]} - The references.
   */
  getReferences() { return this._references }

  /**
   * Runs bigint.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  bigint(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "bigint"}, args)) }

  /**
   * Runs blob.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  blob(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "blob"}, args)) }

  /**
   * Runs boolean.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  boolean(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "boolean"}, args)) }

  /**
   * Runs datetime.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  datetime(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "datetime"}, args)) }

  /**
   * Runs decimal.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  decimal(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "decimal"}, args)) }

  /**
   * Runs integer.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  integer(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "integer"}, args)) }

  /**
   * Runs json.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  json(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "json"}, args)) }

  /**
   * Runs tinyint.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  tinyint(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "tinyint"}, args)) }

  /**
   * Runs references.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  references(name, args) {
    const columnName = `${name}_id`
    const referenceArgs = args || {}
    const reference = new TableReference(name, referenceArgs)
    const {index, polymorphic, ...restArgs} = referenceArgs
    const columnArgs = Object.assign({isNewColumn: true, type: "uuid"}, restArgs)
    const column = new TableColumn(columnName, columnArgs)
    const indexArgs = typeof index == "object" ? {unique: index.unique === true} : undefined
    const tableIndex = new TableIndex([column], indexArgs)

    this.getColumns().push(column)
    this.getIndexes().push(tableIndex)
    this.getReferences().push(reference)

    if (polymorphic) {
      const typeColumnName = `${name}_type`
      const typeColumn = new TableColumn(typeColumnName, {isNewColumn: true, type: "string"})

      this.getColumns().push(typeColumn)
    }
  }

  /**
   * Runs string.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  string(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "string"}, args)) }

  /**
   * Runs text.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  text(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "text"}, args)) }

  /**
   * Runs timestamps.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  timestamps(args) {
    this.datetime("created_at", args)
    this.datetime("updated_at", args)
  }

  /**
   * Runs uuid.
   * @param {string} name - Name.
   * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
   * @returns {void} - No return value.
   */
  uuid(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "uuid"}, args)) }
}
