class TableColumn {
  constructor(name, args) {
    this.args = args
    this.name = name
  }

  getName = () => this.name
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

export {TableColumn}

export default class TableData {
  _columns = []
  _indexes = []
  _references = []

  constructor(name, args = {}) {
    this.args = args
    this._name = name
  }

  _defineColumn(name, args = {}) {
    const column = new TableColumn(name, args)

    this._columns.push(column)
  }

  getColumns = () => this._columns
  getName = () => this._name
  getIfNotExists = () => this.args.ifNotExists
  getIndexes = () => this._indexes
  getReferences = () => this._references

  bigint = (name, args = {}) => this._defineColumn(name, Object.assign({type: "bigint"}, args))
  boolean = (name, args) => this._defineColumn(name, Object.assign({type: "boolean"}, args))
  datetime = (name, args) => this._defineColumn(name, Object.assign({type: "datetime"}, args))
  integer = (name, args = {}) => this._defineColumn(name, Object.assign({type: "integer"}, args))

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

  string = (name, args) => this._defineColumn(name, Object.assign({type: "string"}, args))
  text = (name, args) => this._defineColumn(name, Object.assign({type: "text"}, args))

  timestamps(args = {}) {
    this.datetime("created_at", args)
    this.datetime("updated_at", args)
  }
}
