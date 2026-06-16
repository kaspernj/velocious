// @ts-check

/**
 * AddColumnArgsType type.
 * @typedef {object} AddColumnArgsType
 * @property {?} [default] - Default value for the column.
 * @property {object} [foreignKey] - Foreign key definition for the column.
 * @property {boolean | {unique: boolean}} [index] - Whether to add an index (optionally unique).
 * @property {boolean} [null] - Whether the column allows null values.
 * @property {boolean} [primaryKey] - Whether the column is a primary key.
 * @property {boolean} [unique] - Whether the column enforces uniqueness.
 */
/**
 * CreateTableIdArgsType type.
 * @typedef {object} CreateTableIdArgsType
 * @property {?} [default] - Default value for the ID column.
 * @property {string} [type] - Column type for the ID column.
 */
/**
 * CreateTableArgsType type.
 * @typedef {object} CreateTableArgsType
 * @property {boolean} [ifNotExists] - Skip creation if the table already exists.
 * @property {CreateTableIdArgsType | false} [id] - ID column options or false to skip ID.
 */
/**
 * CreateTableCallbackType type.
 * @typedef {(table: TableData) => void} CreateTableCallbackType
 */

import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"
class NotImplementedError extends Error {}

export {NotImplementedError}

export default class VelociousDatabaseMigration {
  /**
   * Runs on databases.
   * @param {string[]} databaseIdentifiers - Database identifiers.
   * @returns {void} - No return value.
   */
  static onDatabases(databaseIdentifiers) {
    this._databaseIdentifiers = databaseIdentifiers
  }

  /**
   * Runs get database identifiers.
   * @returns {string[] | undefined} - The database identifiers.
   */
  static getDatabaseIdentifiers() {
    return this._databaseIdentifiers
  }

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.databaseIdentifier - Database identifier.
   * @param {import("../drivers/base.js").default} args.db - Database connection.
   */
  constructor({configuration, databaseIdentifier = "default", db}) {
    if (!databaseIdentifier) throw new Error("No database identifier given")
    if (!db) throw new Error("No 'db' given")

    this.configuration = configuration
    this._databaseIdentifier = databaseIdentifier
    this._db = db
  }

  _getDatabaseIdentifier() {
    if (!this._databaseIdentifier) throw new Error("No database identifier set")

    return this._databaseIdentifier
  }

  /**
   * Runs get driver.
   * @returns {import("../drivers/base.js").default} - The driver.
   */
  getDriver() { return this._db }
  connection() { return this.getDriver() }

  async change() {
    throw new NotImplementedError("'change' not implemented")
  }

  async up() {
    throw new NotImplementedError("'change' not implemented")
  }

  async down() {
    throw new NotImplementedError("'change' not implemented")
  }

  /**
   * Runs execute.
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../drivers/base.js").QueryResultType>} - Resolves with the execute.
   */
  async execute(sql) {
    return await this.connection().query(sql)
  }

  /**
   * Runs add column.
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   * @param {string} columnType - Column type.
   * @param {AddColumnArgsType} [args] - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async addColumn(tableName, columnName, columnType, args) {
    if (!columnType) throw new Error("No column type given")

    const tableColumnArgs = Object.assign({isNewColumn: true, type: columnType}, args)
    const tableData = new TableData(tableName)

    tableData.addColumn(columnName, tableColumnArgs)

    const sqls = await this.getDriver().alterTableSQLs(tableData)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * Runs remove column.
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async removeColumn(tableName, columnName) {
    const tableColumnArgs = Object.assign({dropColumn: true})
    const tableData = new TableData(tableName)

    tableData.addColumn(columnName, tableColumnArgs)

    const sqls = await this.getDriver().alterTableSQLs(tableData)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * AddIndexArgsType type.
   * @typedef {object} AddIndexArgsType
   * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
   * @property {string} [name] - Explicit index name to use.
   * @property {boolean} [unique] - Whether the index should be unique.
   */
  /**
   * Runs add index.
   * @param {string} tableName - Table name.
   * @param {string | Array<string | import("../table-data/table-column.js").default>} columns - Column name or array of column names.
   * @param {AddIndexArgsType} [args] - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async addIndex(tableName, columns, args) {
    const normalizedColumns = typeof columns === "string" ? [columns] : columns
    const createIndexArgs = Object.assign(
      {
        columns: normalizedColumns,
        tableName
      },
      args
    )
    const sqls = await this.getDriver().createIndexSQLs(createIndexArgs)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * AddForeignKeyArgsType type.
   * @typedef {object} AddForeignKeyArgsType
   * @property {string} [columnName] - Override the derived FK column name (default: `${reference_underscored}_id`).
   * @property {string} [name] - Override the derived constraint name (default: `fk_${tableName}_${referenceName}`).
   * @property {string} [referencedColumnName] - Override the referenced column name (default: `id`).
   * @property {string} [referencedTableName] - Override the derived referenced table (default: pluralized `referenceName`).
   */
  /**
   * Runs add foreign key.
   * @param {string} tableName - Table the FK lives on.
   * @param {string} referenceName - Singular reference name. Defaults derive
   *   the FK column as `${reference}_id`, the referenced table by pluralizing
   *   the reference, the referenced column as `id`, and the constraint name
   *   as `fk_${tableName}_${referenceName}`. Override any of those via `args`
   *   when the schema doesn't follow the convention.
   * @param {AddForeignKeyArgsType} [args] - Optional overrides.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async addForeignKey(tableName, referenceName, args = {}) {
    const {columnName, name, referencedColumnName, referencedTableName, ...restArgs} = args

    restArgsError(restArgs)

    const referenceNameUnderscore = inflection.underscore(referenceName)
    const resolvedReferencedTableName = referencedTableName || inflection.pluralize(referenceNameUnderscore)
    const resolvedColumnName = columnName || `${referenceNameUnderscore}_id`
    const resolvedReferencedColumnName = referencedColumnName || "id"
    const resolvedName = name || `fk_${tableName}_${referenceName}`

    await this.getDriver().addForeignKey(
      tableName,
      resolvedColumnName,
      resolvedReferencedTableName,
      resolvedReferencedColumnName,
      {
        isNewForeignKey: true,
        name: resolvedName
      }
    )
  }

  /**
   * Runs add reference.
   * @param {string} tableName - Table name.
   * @param {string} referenceName - Reference name.
   * @param {object} args - Options object.
   * @param {boolean} [args.foreignKey] - Whether foreign key.
   * @param {boolean} [args.null] - Whether nullable.
   * @param {string} [args.type] - Type identifier.
   * @param {boolean} [args.unique] - Whether unique.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async addReference(tableName, referenceName, args) {
    const {foreignKey, null: nullable, type, unique, ...restArgs} = args
    const columnName = `${inflection.underscore(referenceName)}_id`

    restArgsError(restArgs)

    const columnType = type || "integer"
    const columnArgs = nullable !== undefined ? {null: nullable} : undefined

    await this.addColumn(tableName, columnName, columnType, columnArgs)
    await this.addIndex(tableName, [columnName], {unique: unique})

    if (foreignKey) {
      await this.addForeignKey(tableName, referenceName)
    }
  }

  /**
   * Runs remove reference.
   * @param {string} tableName - Table name.
   * @param {string} referenceName - Reference name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async removeReference(tableName, referenceName) {
    const columnName = `${inflection.underscore(referenceName)}_id`

    this.removeColumn(tableName, columnName)
  }

  /**
   * Runs change column null.
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   * @param {boolean} nullable - Whether nullable.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async changeColumnNull(tableName, columnName, nullable) {
    const table = await this.getDriver().getTableByName(tableName)

    if (!table) throw new Error(`Table ${tableName} does not exist`)

    const column = await table.getColumnByName(columnName)

    if (!column) throw new Error(`Column ${columnName} does not exist in table ${tableName}`)

    await column.changeNullable(nullable)
  }

  /**
   * Runs column exists.
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   * @returns {Promise<boolean>} - Resolves with Whether column exists.
   */
  async columnExists(tableName, columnName) {
    const table = await this.getDriver().getTableByName(tableName)

    if (table) {
      const column = await table.getColumnByName(columnName)

      if (column) {
        return true
      }
    }

    return Boolean(false)
  }

  /**
   * Sets up the database schema for a gap-less positional list. Adds the
   * position column (INT NOT NULL) if absent and creates a UNIQUE index on
   * (scope, position). This is the schema-side counterpart of
   * `Model.actsAsList()`.
   * @param {string} tableName - Table name.
   * @param {string} positionColumn - Column name for the position (e.g. "row_number").
   * @param {object} options - Options.
   * @param {string} options.scope - Column name for the scope (e.g. "board_column_id").
   * @returns {Promise<void>}
   */
  async addActsAsList(tableName, positionColumn, {scope}) {
    if (!(await this.columnExists(tableName, positionColumn))) {
      await this.addColumn(tableName, positionColumn, "integer", {null: false})
    } else {
      await this.changeColumnNull(tableName, positionColumn, false)
    }

    await this.addIndex(tableName, [scope, positionColumn], {unique: true})
  }

  /**
   * Creates a table with default options.
   * @overload
   * @param {string} tableName - Table name.
   * @param {CreateTableCallbackType} callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
   */
  /**
   * Creates a table with explicit options.
   * @overload
   * @param {string} tableName - Table name.
   * @param {CreateTableArgsType} args - Options object.
   * @param {CreateTableCallbackType} callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
   */
  /**
   * Runs create table.
   * @param {string} tableName - Table name.
   * @param {CreateTableArgsType | CreateTableCallbackType} arg1 - Arg1.
   * @param {CreateTableCallbackType | undefined} [arg2] - Arg2.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createTable(tableName, arg1, arg2) {
    let args
    let callback

    if (typeof arg1 == "function") {
      args = {}
      callback = arg1
    } else {
      args = arg1
      callback = arg2
    }

    const {id = {}, ifNotExists = false, ...restArgs} = args
    const databaseIdentifier = this._getDatabaseIdentifier()
    const databasePool = this.configuration.getDatabasePool(databaseIdentifier)
    let idDefault, idType, restArgsId

    if (id !== false) {
      ({default: idDefault, type: idType, ...restArgsId} = id)

      restArgsError(restArgsId)
    }

    if (!idType) {
      idType = databasePool.primaryKeyType()
    }
    const driverSupportsDefaultUUID = this.getDriver().supportsDefaultPrimaryKeyUUID?.()
    const lowerIdType = idType?.toLowerCase()
    const isUUIDPrimaryKey = lowerIdType == "uuid"
    const numericAutoIncrementTypes = ["int", "integer", "bigint", "smallint", "tinyint"]
    let idAutoIncrement = numericAutoIncrementTypes.includes(lowerIdType || "")

    if (isUUIDPrimaryKey) {
      idAutoIncrement = false

      if (driverSupportsDefaultUUID) {
        if (idDefault === undefined) {
          idDefault = () => "UUID()"
        }
      } else if (idDefault === undefined) {
        // Let application code assign UUIDs (see DatabaseRecord.insert) when the driver can't do it.
        idDefault = undefined
      }
      // If driver doesn't support UUID() but the caller explicitly set a default, respect it.
    }

    const tableData = new TableData(tableName, {ifNotExists, primaryKeyType: databasePool.primaryKeyType()})

    restArgsError(restArgs)

    if (!(idType in tableData)) throw new Error(`Unsupported primary key type: ${idType}`)

    if (id !== false) {
      tableData.addColumn("id", {autoIncrement: idAutoIncrement, default: idDefault, null: false, primaryKey: true, type: idType})
    }

    if (callback) {
      callback(tableData)
    }

    const sqls = await this.getDriver().createTableSql(tableData)

    for (const sql of sqls) {
      await this._db.query(sql)
    }
  }

  /**
   * Runs drop table.
   * @param {string} tableName - Table name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async dropTable(tableName) {
    await this.getDriver().dropTable(tableName)
  }

  /**
   * Runs rename column.
   * @param {string} tableName - Table name.
   * @param {string} oldColumnName - Previous column name.
   * @param {string} newColumnName - New column name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    await this.getDriver().renameColumn(tableName, oldColumnName, newColumnName)
  }

  /**
   * Runs table exists.
   * @param {string} tableName - Table name.
   * @returns {Promise<boolean>} - Resolves with Whether table exists.
   */
  async tableExists(tableName) {
    const exists = await this.getDriver().tableExists(tableName)

    return exists
  }
}
