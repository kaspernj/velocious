import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableForeignKey from "./table-foreign-key.js"

export default class TableColumn {
  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {boolean} args.isNewColumn
   * @param {number} args.maxLength
   * @param {string} args.name
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @param {string} args.type
   */
  constructor(name, args) {
    if (args) {
      const {autoIncrement, default: columnDefault, dropColumn, foreignKey, index, isNewColumn, maxLength, name, null: argsNull, primaryKey, type, ...restArgs} = args // eslint-disable-line no-unused-vars

      if (Object.keys(args).length == 0) {
        throw new Error("Empty args given")
      }

      restArgsError(restArgs)
    }

    this.args = args || {}
    this.name = name
  }

  /**
   * @returns {string} name
   */
  getName() { return this.name }

  /**
   * @returns {string}
   */
  getNewName() { return this._newName }

  /**
   * @param {string} newName
   * @returns {void}
   */
  setNewName(newName) { this._newName = newName }

  /**
   * @returns {string}
   */
  getActualName() { return this.getNewName() || this.getName() }

  /**
   * @returns {boolean}
   */
  getAutoIncrement() { return this.args?.autoIncrement || false }

  /**
   * @param {boolean} newAutoIncrement
   * @returns {void}
   */
  setAutoIncrement(newAutoIncrement) { this.args.autoIncrement = newAutoIncrement }

  /**
   * @returns {any}
   */
  getDefault() { return this.args?.default }

  /**
   * @returns {void}
   */
  setDefault(newDefault) { this.args.default = newDefault }

  /**
   * @returns {boolean}
   */
  getDropColumn() { return this.args?.dropColumn || false }

  /**
   * @returns {boolean|object}
   */
  getForeignKey() { return this.args?.foreignKey }

  /**
   * @param {boolean|object} newForeignKey
   * @returns {void}
   */
  setForeignKey(newForeignKey) { this.args.foreignKey = newForeignKey }

  /**
   * @returns {boolean|object}
   */
  getIndex() { return this.args?.index }

  /**
   * @param {boolean|object} newIndex
   * @returns {void}
   */
  setIndex(newIndex) { this.args.index = newIndex }

  /**
   * @returns {number}
   */
  getMaxLength() { return this.args?.maxLength }

  /**
   * @param {number} newMaxLength
   * @returns {void}
   */
  setMaxLength(newMaxLength) { this.args.maxLength = newMaxLength }

  /**
   * @returns {boolean}
   */
  getNull() { return this.args?.null }

  /**
   * @param {boolean} nullable
   * @returns {void}
   */
  setNull(nullable) { this.args.null = nullable }

  /**
   * @returns {boolean}
   */
  getPrimaryKey() { return this.args?.primaryKey }

  /**
   * @param {boolean} newPrimaryKey
   * @returns {void}
   */
  setPrimaryKey(newPrimaryKey) { this.args.primaryKey = newPrimaryKey }

  /**
   * @returns {string}
   */
  getType() { return this.args?.type }

  /**
   * @param {string} newType
   * @returns {void}
   */
  setType(newType) { this.args.type = newType }

  /**
   * @returns {boolean}
   */
  isNewColumn() { return this.args?.isNewColumn || false }

  /**
   * @param {object} args
   * @param {boolean} args.forAlterTable
   * @template T extends import("../drivers/base.js").default
   * @param {T} args.driver
   * @returns {string}
   */
  getSQL({forAlterTable, driver, ...restArgs}) {
    restArgsError(restArgs)

    const databaseType = driver.getType()
    const options = driver.options()
    let maxlength = this.getMaxLength()
    let type = this.getType()?.toUpperCase()

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

    let sql = `${options.quoteColumnName(this.getActualName())} `

    if (databaseType == "pgsql" && forAlterTable) sql += "TYPE "
    if (type) sql += type
    if (type && maxlength !== undefined && maxlength !== null) sql += `(${maxlength})`

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
        foreignKeyTable = inflection.pluralize(this.getActualName().replace(/_id$/, ""))
      } else if (foreignKey instanceof TableForeignKey) {
        foreignKeyColumn = foreignKey.getReferencedColumnName()
        foreignKeyTable = foreignKey.getReferencedTableName()
      } else {
        throw new Error(`Unknown foreign key type given: ${foreignKey} (${typeof foreignKey})`)
      }

      sql += ` REFERENCES ${options.quoteTableName(foreignKeyTable)}(${options.quoteColumnName(foreignKeyColumn)})`
    }

    return sql
  }
}
