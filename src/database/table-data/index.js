import TableColumn from "./table-column.js"
import TableIndex from "./table-index.js"
import TableReference from "./table-reference.js"

export default class TableData {
  _columns = []
  _foreignKeys = []
  _indexes = []
  _references = []

  constructor(name, args = {}) {
    if (!name) throw new Error(`Invalid table name: ${name}`)

    this.args = args
    this._name = name
  }

  addColumn(name, args = {}) {
    if (name instanceof TableColumn) {
      this._columns.push(name)
    } else {
      const column = new TableColumn(name, args)

      this._columns.push(column)
    }
  }

  getColumns() { return this._columns }

  addForeignKey(foreignKey) { this._foreignKeys.push(foreignKey) }
  getForeignKeys() { return this._foreignKeys }

  addIndex(index) { this._indexes.push(index) }
  getIndexes() { return this._indexes }

  getName() { return this._name }
  setName(newName) { this._name = newName }
  getIfNotExists() { return this.args.ifNotExists }
  getReferences() { return this._references }

  bigint(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "bigint"}, args)) }
  blob(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "blob"}, args)) }
  boolean(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "boolean"}, args)) }
  datetime(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "datetime"}, args)) }
  integer(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "integer"}, args)) }
  tinyint(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "tinyint"}, args)) }

  references(name, args = {}) {
    const columnName = `${name}_id`
    const reference = new TableReference(name, args)
    const columnArgs = Object.assign({isNewColumn: true, type: "bigint"}, args)
    const column = new TableColumn(columnName, columnArgs)
    const index = new TableIndex([column])

    this._columns.push(column)
    this._indexes.push(index)
    this._references.push(reference)
  }

  string(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "string"}, args)) }
  text(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "text"}, args)) }

  timestamps(args = {}) {
    this.datetime("created_at", args)
    this.datetime("updated_at", args)
  }

  uuid(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "uuid"}, args)) }
}
