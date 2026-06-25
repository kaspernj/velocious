// @ts-check

/**
 * AddColumnArgsType type.
 * @typedef {object} AddColumnArgsType
 * @property {?} [default] - Default value for the column.
 * @property {object} [foreignKey] - Foreign key definition for the column.
 * @property {boolean | {unique: boolean}} [index] - Whether to add an index (optionally unique).
 * @property {number} [limit] - Alias for maxLength (varchar length limit) on string-like columns.
 * @property {number} [maxLength] - Maximum length for string-like columns (e.g. varchar length).
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
/**
 * LegacyLocalDateTimesMigrationArgsType type.
 * @typedef {object} LegacyLocalDateTimesMigrationArgsType
 * @property {Record<string, string[]>} [columnsByTable] - Explicit datetime columns keyed by table name.
 * @property {number} [legacyLocalOffsetMinutes] - UTC-minus-local offset in minutes for legacy rows.
 * @property {string[]} [tables] - Tables to migrate. Defaults to all non-internal tables.
 */

import { convertLegacyDateValueToUtcStorage } from "../datetime-storage.js"
import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import CreateIndexBase from "../query/create-index-base.js"
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
   * RemoveIndexArgsType type.
   * @typedef {object} RemoveIndexArgsType
   * @property {string} [name] - Explicit index name to remove.
   */
  /**
   * Runs remove index.
   * @param {string} tableName - Table name.
   * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns whose default addIndex name should be removed.
   * @param {RemoveIndexArgsType} [args] - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async removeIndex(tableName, nameOrColumns, args = {}) {
    const {name, ...restArgs} = args

    restArgsError(restArgs)

    const removeIndexName = name || this._removeIndexName(tableName, nameOrColumns)
    const sqls = await this.getDriver().removeIndexSQLs({name: removeIndexName, tableName})

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * Runs remove index name.
   * @param {string} tableName - Table name.
   * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
   * @returns {string} - The index name.
   */
  _removeIndexName(tableName, nameOrColumns) {
    if (typeof nameOrColumns === "string") return nameOrColumns

    const createIndex = new CreateIndexBase({
      columns: nameOrColumns,
      driver: this.getDriver(),
      tableName
    })

    return createIndex.generateIndexName()
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
   * Migrates legacy timezone-less local datetime rows into UTC datetime storage.
   * New SQLite UTC rows include a timezone suffix and are skipped.
   * @param {LegacyLocalDateTimesMigrationArgsType} [args] - Migration options.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async migrateLegacyLocalDateTimesToUtcStorage(args = {}) {
    const {columnsByTable, legacyLocalOffsetMinutes, tables, ...restArgs} = args

    restArgsError(restArgs)

    const tableNames = await this._legacyLocalDateTimesTableNames(tables)

    for (const tableName of tableNames) {
      await this._migrateLegacyLocalDateTimesTable({
        columnsByTable,
        legacyLocalOffsetMinutes,
        tableName
      })
    }
  }

  /**
   * Resolves table names for a legacy local datetime migration.
   * @param {string[] | undefined} tables - Explicit table names.
   * @returns {Promise<string[]>} - Table names.
   */
  async _legacyLocalDateTimesTableNames(tables) {
    if (tables) return tables

    return (await this.getDriver().getTables())
      .map((table) => table.getName())
      .filter((tableName) => tableName != "schema_migrations" && !tableName.startsWith("sqlite_"))
  }

  /**
   * Migrates one table's legacy local datetime values.
   * @param {object} args - Options.
   * @param {Record<string, string[]> | undefined} args.columnsByTable - Explicit columns keyed by table.
   * @param {number | undefined} args.legacyLocalOffsetMinutes - UTC-minus-local offset in minutes.
   * @param {string} args.tableName - Table name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _migrateLegacyLocalDateTimesTable({columnsByTable, legacyLocalOffsetMinutes, tableName}) {
    const driver = this.getDriver()
    const table = await driver.getTableByNameOrFail(tableName)
    const columns = await this._legacyLocalDateTimesColumns({columnsByTable, table})

    if (columns.length === 0) return

    const primaryKeyColumn = await this._legacyLocalDateTimesPrimaryKey(table)
    const selectedColumns = [primaryKeyColumn, ...columns]
    const selectSql = selectedColumns
      .map((columnName) => driver.quoteColumn(columnName))
      .join(", ")
    const rows = await driver.query(`SELECT ${selectSql} FROM ${driver.quoteTable(tableName)}`)

    for (const row of rows) {
      for (const columnName of columns) {
        const value = row[columnName]
        const convertedValue = convertLegacyDateValueToUtcStorage(value, {
          databaseType: driver.getType(),
          legacyLocalOffsetMinutes
        })

        if (convertedValue === value) continue

        await driver.query(`
          UPDATE ${driver.quoteTable(tableName)}
          SET ${driver.quoteColumn(columnName)} = ${driver.quote(convertedValue)}
          WHERE ${driver.quoteColumn(primaryKeyColumn)} = ${driver.quote(row[primaryKeyColumn])}
        `)
      }
    }
  }

  /**
   * Resolves date-like columns for one table.
   * @param {object} args - Options.
   * @param {Record<string, string[]> | undefined} args.columnsByTable - Explicit columns keyed by table.
   * @param {import("../drivers/base-table.js").default} args.table - Table metadata.
   * @returns {Promise<string[]>} - Date-like column names.
   */
  async _legacyLocalDateTimesColumns({columnsByTable, table}) {
    const explicitColumns = columnsByTable?.[table.getName()]

    if (explicitColumns) return explicitColumns

    return (await table.getColumns())
      .filter((column) => this._legacyLocalDateTimesColumnIsDateLike(column))
      .map((column) => column.getName())
  }

  /**
   * Checks whether a column should be included by default.
   * @param {import("../drivers/base-column.js").default} column - Column metadata.
   * @returns {boolean} - Whether the column is date-like.
   */
  _legacyLocalDateTimesColumnIsDateLike(column) {
    const columnType = column.getType().toLowerCase()

    return columnType.includes("date") || columnType.includes("timestamp")
  }

  /**
   * Resolves the single primary key column for row updates.
   * @param {import("../drivers/base-table.js").default} table - Table metadata.
   * @returns {Promise<string>} - Primary key column name.
   */
  async _legacyLocalDateTimesPrimaryKey(table) {
    const primaryKeyColumns = (await table.getColumns()).filter((column) => column.getPrimaryKey())

    if (primaryKeyColumns.length != 1) {
      throw new Error(`Expected exactly one primary key on ${table.getName()} but found ${primaryKeyColumns.length}`)
    }

    return primaryKeyColumns[0].getName()
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
    const driver = this.getDriver()
    const defaultPrimaryKeyType = driver.primaryKeyType()
    let idDefault, idType, restArgsId

    if (id !== false) {
      ({default: idDefault, type: idType, ...restArgsId} = id)

      restArgsError(restArgsId)
    }

    if (!idType) {
      idType = defaultPrimaryKeyType
    }
    const driverSupportsDefaultUUID = driver.supportsDefaultPrimaryKeyUUID?.()
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

    const tableData = new TableData(tableName, {ifNotExists, primaryKeyType: defaultPrimaryKeyType})

    restArgsError(restArgs)

    if (!(idType in tableData)) throw new Error(`Unsupported primary key type: ${idType}`)

    if (id !== false) {
      tableData.addColumn("id", {autoIncrement: idAutoIncrement, default: idDefault, null: false, primaryKey: true, type: idType})
    }

    if (callback) {
      callback(tableData)
    }

    const sqls = await driver.createTableSql(tableData)

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
