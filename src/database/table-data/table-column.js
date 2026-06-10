// @ts-check

/**
 * Defines this typedef.
 * @typedef {{unique: boolean}} IndexArgType
 */

import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableForeignKey from "./table-foreign-key.js"

/**
 * TableColumnArgsType type.
 * @typedef {object} TableColumnArgsType
 * @property {boolean} [autoIncrement] - Whether the column auto-increments.
 * @property {?} [default] - Default value for the column.
 * @property {boolean} [dropColumn] - Whether the column should be dropped.
 * @property {boolean|object} [foreignKey] - Foreign key options or flag.
 * @property {boolean|IndexArgType} [index] - Whether the column should be indexed.
 * @property {boolean} [isNewColumn] - Whether this column is being added in a migration.
 * @property {number} [limit] - Alias for maxLength (varchar length limit).
 * @property {number} [maxLength] - Maximum length for the column value.
 * @property {string} [notes] - Column notes or comment.
 * @property {boolean} [null] - Whether the column allows null values.
 * @property {boolean} [polymorphic] - Whether the column is polymorphic.
 * @property {number} [precision] - Numeric precision (total digits) for decimal/numeric types.
 * @property {boolean} [primaryKey] - Whether the column is a primary key.
 * @property {number} [scale] - Numeric scale (digits after decimal point) for decimal/numeric types.
 * @property {string} [type] - Column data type.
 */

export default class TableColumn {
  /**
   * Runs constructor.
   * @param {string} name - Name.
   * @param {TableColumnArgsType} [args] - Options object.
   */
  constructor(name, args) {
    if (args) {
      const {autoIncrement, default: columnDefault, dropColumn, foreignKey, index, isNewColumn, limit, maxLength, notes, null: argsNull, polymorphic, precision, primaryKey, scale, type, ...restArgs} = args // eslint-disable-line no-unused-vars

      if (Object.keys(args).length == 0) {
        throw new Error("Empty args given")
      }

      restArgsError(restArgs)

      // Normalize limit → maxLength for string-like types only.
      if (limit !== undefined && maxLength === undefined) {
        const normalizedType = typeof type === "string" ? type.toLowerCase() : ""

        if (normalizedType === "string" || normalizedType === "text" || normalizedType === "varchar" || normalizedType === "nvarchar" || normalizedType === "char") {
          args.maxLength = limit
        }
      }
    }

    this.args = args || {}
    this.name = name
  }

  /**
   * Runs get name.
   * @returns {string} name
   */
  getName() { return this.name }

  /**
   * Runs get new name.
   * @returns {string | undefined} - The new name.
   */
  getNewName() { return this._newName }

  /**
   * Runs set new name.
   * @param {string} newName - New name.
   * @returns {void} - No return value.
   */
  setNewName(newName) { this._newName = newName }

  /**
   * Runs get actual name.
   * @returns {string} - The actual name.
   */
  getActualName() { return this.getNewName() || this.getName() }

  /**
   * Runs get auto increment.
   * @returns {boolean} - Whether auto increment.
   */
  getAutoIncrement() { return this.args?.autoIncrement || false }

  /**
   * Runs set auto increment.
   * @param {boolean} newAutoIncrement - New auto increment.
   * @returns {void} - No return value.
   */
  setAutoIncrement(newAutoIncrement) { this.args.autoIncrement = newAutoIncrement }

  /**
   * Runs get default.
   * @returns {? | (() => ?)} - The default value or factory.
   */
  getDefault() { return this.args?.default }

  /**
   * Runs set default.
   * @param {?} newDefault - New default.
   * @returns {void} - No return value.
   */
  setDefault(newDefault) { this.args.default = newDefault }

  /**
   * Runs get drop column.
   * @returns {boolean} - Whether drop column.
   */
  getDropColumn() { return this.args?.dropColumn || false }

  /**
   * Runs get foreign key.
   * @returns {boolean | object | undefined} - Whether foreign key.
   */
  getForeignKey() { return this.args?.foreignKey }

  /**
   * Runs set foreign key.
   * @param {boolean | object | undefined} newForeignKey - New foreign key.
   * @returns {void} - No return value.
   */
  setForeignKey(newForeignKey) { this.args.foreignKey = newForeignKey }

  /**
   * Runs get index.
   * @returns {boolean|IndexArgType} - Whether index.
   */
  getIndex() { return this.args?.index || false }

  /**
   * Runs get index args.
   * @returns {IndexArgType} - The index args.
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
   * Runs set index.
   * @param {boolean|IndexArgType} newIndex - New index.
   * @returns {void} - No return value.
   */
  setIndex(newIndex) { this.args.index = newIndex }

  /**
   * Runs get max length.
   * @returns {number | undefined} - The max length.
   */
  getMaxLength() { return this.args?.maxLength }

  /**
   * Runs set max length.
   * @param {number | undefined} newMaxLength - New max length.
   * @returns {void} - No return value.
   */
  setMaxLength(newMaxLength) { this.args.maxLength = newMaxLength }

  /**
   * Runs get notes.
   * @returns {string | undefined} - The notes.
   */
  getNotes() { return this.args?.notes }

  /**
   * Runs set notes.
   * @param {string | undefined} newNotes - New notes.
   * @returns {void} - No return value.
   */
  setNotes(newNotes) { this.args.notes = newNotes }

  /**
   * Runs get null.
   * @returns {boolean | undefined} - Whether null.
   */
  getNull() { return this.args?.null }

  /**
   * Runs set null.
   * @param {boolean} nullable - Whether nullable.
   * @returns {void} - No return value.
   */
  setNull(nullable) { this.args.null = nullable }

  /**
   * Runs get precision.
   * @returns {number | undefined} - Numeric precision (total digits).
   */
  getPrecision() { return this.args?.precision }

  /**
   * Runs get primary key.
   * @returns {boolean} - Whether primary key.
   */
  getPrimaryKey() { return this.args?.primaryKey || false }

  /**
   * Runs set primary key.
   * @param {boolean} newPrimaryKey - New primary key.
   * @returns {void} - No return value.
   */
  setPrimaryKey(newPrimaryKey) { this.args.primaryKey = newPrimaryKey }

  /**
   * Runs get scale.
   * @returns {number | undefined} - Numeric scale (digits after decimal point).
   */
  getScale() { return this.args?.scale }

  /**
   * Runs get type.
   * @returns {string | undefined} - The type.
   */
  getType() { return this.args?.type }

  /**
   * Runs set type.
   * @param {string | undefined} newType - New type.
   * @returns {void} - No return value.
   */
  setType(newType) { this.args.type = newType }

  /**
   * Runs get type hint notes.
   * @returns {string | undefined} - The type hint notes.
   */
  getTypeHintNotes() {
    if (this.getType()?.toLowerCase() == "boolean") return "velocious:type=boolean"
  }

  /**
   * Runs get notes for database.
   * @param {string} databaseType - Database type.
   * @returns {string | undefined} - Notes for the database.
   */
  getNotesForDatabase(databaseType) {
    if (!["mysql", "pgsql"].includes(databaseType)) return

    return this.getNotes() || this.getTypeHintNotes()
  }

  /**
   * Runs is new column.
   * @returns {boolean} - Whether new column.
   */
  isNewColumn() { return this.args?.isNewColumn || false }

  /**
   * Runs get sql.
   * @param {object} args - Options object.
   * @param {boolean} args.forAlterTable - Whether for alter table.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {boolean} [args.skipForeignKey] - Skip emitting the inline REFERENCES clause (the caller emits a table-level FOREIGN KEY constraint instead).
   * @returns {string} - SQL string.
   */
  getSQL({forAlterTable, driver, skipForeignKey, ...restArgs}) {
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
      type = databaseType == "mssql" ? "NVARCHAR" : "VARCHAR"
      maxlength ||= 255
    }
    if (databaseType == "mysql" && type == "BOOLEAN") {
      type = "TINYINT"
      maxlength = 1
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
      } else if (type == "TEXT") {
        type = "NVARCHAR(MAX)"
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

    const precision = this.getPrecision()
    const scale = this.getScale()

    if ((scale !== undefined && scale !== null) && (precision === undefined || precision === null)) {
      throw new Error(`Column '${this.getActualName()}': scale requires precision to be set`)
    }

    if (precision !== undefined && precision !== null) {
      sql += scale !== undefined && scale !== null ? `(${precision}, ${scale})` : `(${precision})`
    } else if (type && maxlength !== undefined && maxlength !== null) {
      sql += `(${maxlength})`
    }

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

    const defaultValue = this.getDefault()

    if (typeof defaultValue == "function") {
      const evaluatedDefault = defaultValue()

      sql += ` DEFAULT (`

      if (databaseType == "pgsql" && evaluatedDefault == "UUID()") {
        sql += "gen_random_uuid()"
      } else if (databaseType == "mssql" && evaluatedDefault == "UUID()") {
        sql += "NEWID()"
      } else {
        sql += evaluatedDefault
      }

      sql += ")"
    } else if (defaultValue !== undefined && defaultValue !== null) {
      // Emit falsy defaults too (`0`, `false`, `""`). A truthiness check here
      // silently dropped `default: 0`, leaving the column NOT NULL with no
      // default so inserts that omit it fail in strict mode.
      sql += ` DEFAULT ${options.quote(defaultValue)}`
    }

    if (this.getPrimaryKey()) sql += " PRIMARY KEY"
    if (this.getNull() === false) sql += " NOT NULL"

    const notes = this.getNotesForDatabase(databaseType)

    if (notes && databaseType == "mysql") {
      sql += ` COMMENT ${options.quote(notes)}`
    }

    const foreignKey = skipForeignKey ? undefined : this.getForeignKey()

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
