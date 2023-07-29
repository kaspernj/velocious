class TableColumn {
  constructor(name, args) {
    this.args = args
    this.name = name
  }
}

class TableIndex {
  constructor(columns, args) {
    this.args = args
    this.columns = columns
  }

  getColumns = () => this.columns
  getName = () => this.args.name
  getUnique = () => Boolean(this.args.unique)
}

class TableReference {
  constructor(name, args) {
    this.args = args
    this.name = name
  }
}

export default class TableData {
  _columns = []
  _indexes = []
  _references = []

  constructor(name) {
    this._name = name
  }

  getColumns = () => this._columns
  getName = () => this._name
  getIndexes = () => this._indexes
  getReferences = () => this._references

  bigint(name, args = {}) {
    const columnArgs = Object.assign({type: "bigint"}, args)
    const column = new TableColumn(name, columnArgs)

    this._columns.push(column)
  }

  references(name, args = {}) {
    const columnName = `${name}_id`
    const indexName = `index_on_${columnName}`
    const reference = new TableReference(name, args)
    const columnArgs = Object.assign({type: "bigint"}, args)
    const column = new TableColumn(columnName, columnArgs)
    const index = new TableIndex([column], {name: indexName})

    this._columns.push(column)
    this._indexes.push(index)
    this._references.push(reference)
  }

  string(name, args) {
    const columnArgs = Object.assign({type: "string"}, args)
    const column = new TableColumn(name, columnArgs)

    this._columns.push(column)
  }

  text(name, args) {
    const columnArgs = Object.assign({type: "text"}, args)
    const column = new TableColumn(name, columnArgs)

    this._columns.push(column)
  }

  timestamps() {
    const createdAtColumn = new TableColumn("created_at", {type: "datetime"})
    const updatedAtColumn = new TableColumn("updated_at", {type: "datetime"})

    this._columns.push(createdAtColumn)
    this._columns.push(updatedAtColumn)
  }
}
