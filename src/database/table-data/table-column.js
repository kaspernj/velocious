import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableForeignKey from "./table-foreign-key.js"

export default class TableColumn {
  constructor(name, args) {
    if (args) {
      const {autoIncrement, default: columnDefault, foreignKey, index, isNewColumn, maxLength, name, null: argsNull, primaryKey, type, ...restArgs} = args

      if (Object.keys(args).length == 0) {
        throw new Error("Empty args given")
      }

      restArgsError(restArgs)
    }

    this.args = args || {}
    this.name = name
  }

  getAutoIncrement() { return this.args?.autoIncrement }
  getDefault() { return this.args?.default }
  getForeignKey() { return this.args?.foreignKey }
  setForeignKey(newForeignKey) { this.args.foreignKey = newForeignKey }
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

    const foreignKey = this.getForeignKey()

    if (foreignKey) {
      let foreignKeyTable, foreignKeyColumn

      if (foreignKey === true) {
        foreignKeyColumn = "id"
        foreignKeyTable = inflection.pluralize(this.getName().replace(/_id$/, ""))
      } else if (foreignKey instanceof TableForeignKey) {
        foreignKeyColumn = foreignKey.getReferencedColumnName()
        foreignKeyTable = foreignKey.getReferencedTableName()
      } else {
        throw new Error(`Unknown foreign key type given: ${this.getForeignKey()} (${typeof this.getForeignKey()})`)
      }

      sql += ` REFERENCES ${options.quoteTableName(foreignKeyTable)}(${options.quoteColumnName(foreignKeyColumn)})`
    }

    return sql
  }
}
