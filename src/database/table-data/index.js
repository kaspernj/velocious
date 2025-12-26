// @ts-check

import TableColumn from "./table-column.js"
import TableIndex from "./table-index.js"
import TableReference from "./table-reference.js"

/**
 * @typedef {object} TableDataArgsType
 * @property {boolean} ifNotExists - Whether to create the table only if it does not exist.
 */

export default class TableData {
  /** @type {TableColumn[]} */
  _columns = []

  /** @type {import("./table-foreign-key.js").default[]} */
  _foreignKeys = []

  /** @type {TableIndex[]} */
  _indexes = []

  /** @type {TableReference[]} */
  _references = []

  /**
   * @param {string} name
   * @param {TableDataArgsType} [args]
   */
  constructor(name, args) {
    if (!name) throw new Error(`Invalid table name: ${name}`)

    this.args = args
    this._name = name
  }

  /**
   * @param {string|TableColumn} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
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
   * @returns {TableColumn[]} - Result.
   */
  getColumns() { return this._columns }

  /**
   * @param {import("./table-foreign-key.js").default} foreignKey
   */
  addForeignKey(foreignKey) { this._foreignKeys.push(foreignKey) }

  /**
   * @returns {import("./table-foreign-key.js").default[]} - Result.
   */
  getForeignKeys() { return this._foreignKeys }

  /**
   * @param {TableIndex} index
   */
  addIndex(index) { this._indexes.push(index) }

  /**
   * @returns {TableIndex[]} - Result.
   */
  getIndexes() { return this._indexes }

  /**
   * @returns {string} - Result.
   */
  getName() { return this._name }

  /**
   * @param {string} newName
   * @returns {void} - Result.
   */
  setName(newName) { this._name = newName }

  /**
   * @returns {boolean} - Result.
   */
  getIfNotExists() { return this.args?.ifNotExists || false }

  /**
   * @returns {TableReference[]} - Result.
   */
  getReferences() { return this._references }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  bigint(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "bigint"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  blob(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "blob"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  boolean(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "boolean"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  datetime(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "datetime"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  integer(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "integer"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  json(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "json"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  tinyint(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "tinyint"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  references(name, args) {
    const columnName = `${name}_id`
    const referenceArgs = args || {}
    const reference = new TableReference(name, referenceArgs)
    const {index, polymorphic, ...restArgs} = referenceArgs
    const columnArgs = Object.assign({isNewColumn: true, type: "bigint"}, restArgs)
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
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  string(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "string"}, args)) }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  text(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "text"}, args)) }

  /**
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  timestamps(args) {
    this.datetime("created_at", args)
    this.datetime("updated_at", args)
  }

  /**
   * @param {string} name
   * @param {import("./table-column.js").TableColumnArgsType} [args]
   * @returns {void} - Result.
   */
  uuid(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "uuid"}, args)) }
}
