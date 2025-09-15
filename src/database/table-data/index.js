import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"

class TableColumn {
  constructor(name, args) {
    if (args) {
      const {autoIncrement, default: columnDefault, foreignKey, index, isNewColumn, maxLength, name, null: argsNull, primaryKey, type, ...restArgs} = args

      if (Object.keys(args).length == 0) {
        throw new Error("Empty args given")
      }

      restArgsError(restArgs)
    }

    this.args = args
    this.name = name
  }

  getAutoIncrement() { return this.args?.autoIncrement }
  getDefault() { return this.args?.default }
  getForeignKey() { return this.args?.foreignKey }
  getIndex() { return this.args?.index }
  getMaxLength() { return this.args?.maxLength }
  getName() { return this.name }
  getNull() { return this.args?.null }
  setNull(nullable) { this.args.null = nullable }
  getPrimaryKey() { return this.args?.primaryKey }
  getType() { return this.args?.type }
  isNewColumn() { return this.args?.isNewColumn }

  getSQL({forAlterTable, driver}) {
    const databaseType = driver.getType()
    const options = driver.options()
    let maxlength = this.getMaxLength()
    let type = this.getType().toUpperCase()

    if (type == "DATETIME" && databaseType == "pgsql") {
      type = "TIMESTAMP"
    }

    if (type == "STRING") {
      type = "VARCHAR"
      maxlength ||= 255
    }

    if (databaseType == "mssql" && type == "BOOLEAN") {
      type = "BIT"
    } else if (databaseType == "mssql" && type == "UUID") {
      type = "VARCHAR"
      maxlength ||= 36
    }

    if (databaseType == "sqlite" && this.getAutoIncrement() && this.getPrimaryKey()) {
      type = "INTEGER"
    }

    if (databaseType == "pgsql" && this.getAutoIncrement() && this.getPrimaryKey()) {
      type = "SERIAL"
    }

    let sql = `${options.quoteColumnName(this.getName())} `

    if (databaseType == "pgsql" && forAlterTable) sql += "TYPE "

    sql += type

    if (maxlength !== undefined && maxlength !== null) sql += `(${maxlength})`

    if (this.getAutoIncrement() && driver.shouldSetAutoIncrementWhenPrimaryKey()) {
      if (databaseType == "mssql") {
        sql += " IDENTITY"
      } else if (databaseType == "pgsql") {
        if (this.getAutoIncrement() && this.getPrimaryKey()) {
          // Do nothing
        } else {
          throw new Error("pgsql auto increment must be primary key")
        }
      } else {
        sql += " AUTO_INCREMENT"
      }
    }

    if (typeof this.getDefault() == "function") {
      const defaultValue = this.getDefault()()

      sql += ` DEFAULT (`

      if (databaseType == "pgsql" && defaultValue == "UUID()") {
        sql += "gen_random_uuid()"
      } else if (databaseType == "mssql" && defaultValue == "UUID()") {
        sql += "NEWID()"
      } else {
        sql += defaultValue
      }

      sql += ")"
    } else if (this.getDefault()) {
      sql += ` DEFAULT ${options.quote(this.getDefault())}`
    }

    if (this.getPrimaryKey()) sql += " PRIMARY KEY"
    if (this.getNull() === false) sql += " NOT NULL"

    if (this.getForeignKey()) {
      let foreignKeyTable, foreignKeyColumn

      if (this.getForeignKey() === true) {
        foreignKeyColumn = "id"
        foreignKeyTable = inflection.pluralize(this.getName().replace(/_id$/, ""))
      } else {
        throw new Error(`Unknown foreign key type given: ${this.getForeignKey()} (${typeof this.getForeignKey()})`)
      }

      sql += ` REFERENCES ${options.quoteTableName(foreignKeyTable)}(${options.quoteColumnName(foreignKeyColumn)})`
    }

    return sql
  }
}

class TableIndex {
  constructor(columns, args) {
    if (args) {
      const {name, unique, ...restArgs} = args

      restArgsError(restArgs)
    }

    this.args = args
    this.columns = columns
  }

  getColumns() { return this.columns }
  getName() { return this.args.name }
  getUnique() { return Boolean(this.args.unique) }
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
  getName() { return this._name }
  getIfNotExists() { return this.args.ifNotExists }
  getIndexes() { return this._indexes }
  getReferences() { return this._references }

  bigint(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "bigint"}, args)) }
  blob(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "blob"}, args)) }
  boolean(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "boolean"}, args)) }
  datetime(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "datetime"}, args)) }
  integer(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "integer"}, args)) }
  tinyint(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "tinyint"}, args)) }

  references(name, args = {}) {
    const columnName = `${name}_id`
    const indexName = `index_on_${columnName}`
    const reference = new TableReference(name, args)
    const columnArgs = Object.assign({isNewColumn: true, type: "bigint"}, args)
    const column = new TableColumn(columnName, columnArgs)
    const index = new TableIndex([column], {name: indexName})

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
