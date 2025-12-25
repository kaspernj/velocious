// @ts-check

/**
 * @typedef {{unique: boolean}} IndexArgType
 */

import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableForeignKey from "./table-foreign-key.js"

/**
 * @typedef {object} TableColumnArgsType
 * @property {boolean} [autoIncrement]
 * @property {any} [default]
 * @property {boolean} [dropColumn]
 * @property {boolean|object} [foreignKey]
 * @property {boolean|IndexArgType} [index]
 * @property {boolean} [isNewColumn]
 * @property {number} [maxLength]
 * @property {boolean} [null]
 * @property {boolean} [polymorphic]
 * @property {boolean} [primaryKey]
 * @property {string} [type]
 */

export default class TableColumn {
  /**
   * @param {string} name
   * @param {TableColumnArgsType} [args]
   */
  constructor(name, args) {
    if (args) {
      const {autoIncrement, default: columnDefault, dropColumn, foreignKey, index, isNewColumn, maxLength, null: argsNull, polymorphic, primaryKey, type, ...restArgs} = args // eslint-disable-line no-unused-vars

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
   * @returns {string | undefined}
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
   * @param {any} newDefault
   * @returns {void}
   */
  setDefault(newDefault) { this.args.default = newDefault }

  /**
   * @returns {boolean}
   */
  getDropColumn() { return this.args?.dropColumn || false }

  /**
   * @returns {boolean | object | undefined}
   */
  getForeignKey() { return this.args?.foreignKey }

  /**
   * @param {boolean | object | undefined} newForeignKey
   * @returns {void}
   */
  setForeignKey(newForeignKey) { this.args.foreignKey = newForeignKey }

  /**
   * @returns {boolean|IndexArgType}
   */
  getIndex() { return this.args?.index || false }

  /**
   * @returns {IndexArgType}
   */
  getIndexArgs() {
    if (typeof this.args?.index == "object") {
      return this.args.index
    } else {
      return {unique: false}
    }
  }

  getIndexUnique() {
    const index = this.args?.index

    if (typeof index == "object" && index.unique === true) return true

    return false
  }

  /**
   * @param {boolean|IndexArgType} newIndex
   * @returns {void}
   */
  setIndex(newIndex) { this.args.index = newIndex }

  /**
   * @returns {number | undefined}
   */
  getMaxLength() { return this.args?.maxLength }

  /**
   * @param {number | undefined} newMaxLength
   * @returns {void}
   */
  setMaxLength(newMaxLength) { this.args.maxLength = newMaxLength }

  /**
   * @returns {boolean | undefined}
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
  getPrimaryKey() { return this.args?.primaryKey || false }

  /**
   * @param {boolean} newPrimaryKey
   * @returns {void}
   */
  setPrimaryKey(newPrimaryKey) { this.args.primaryKey = newPrimaryKey }

  /**
   * @returns {string | undefined}
   */
  getType() { return this.args?.type }

  /**
   * @param {string | undefined} newType
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
   * @param {import("../drivers/base.js").default} args.driver
   * @returns {string}
   */
  getSQL({forAlterTable, driver, ...restArgs}) {
    restArgsError(restArgs)

    const databaseType = driver.getType()
    const options = driver.options()
    let maxlength = this.getMaxLength()
    let type = this.getType()?.toUpperCase()

    if (databaseType == "pgsql") {
      if (type == "DATETIME") {
        type = "TIMESTAMP"
      } else if (type == "TINYINT") {
        type = "SMALLINT"
      } else if (type == "BLOB") {
        type = "BYTEA"
        maxlength = undefined
      }
    }

    if (type == "STRING") {
      type = "VARCHAR"
      maxlength ||= 255
    }
    if (databaseType == "pgsql" && type == "TINYINT") {
      type = "SMALLINT"
    }

    if (databaseType == "mssql") {
      if (type == "BOOLEAN") {
        type = "BIT"
      } else if (type == "UUID") {
        type = "VARCHAR"
        maxlength ||= 36
      } else if (type == "JSON") {
        type = "NVARCHAR(MAX)"
        maxlength = undefined
      } else if (type == "BLOB") {
        type = "VARBINARY(MAX)"
        maxlength = undefined
      }
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
