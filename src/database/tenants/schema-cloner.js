// @ts-check

import MigrationsLedger from "../migrations-ledger.js"
import TableData from "../table-data/index.js"
import TableIndex from "../table-data/table-index.js"

const SIMPLE_DEFAULT_PATTERN = /^(?:-?\d+(?:\.\d+)?|[A-Za-z0-9 _.,:/@+-]*)$/

/** @type {Record<string, number>} */
const TEXT_TYPE_RANKS = {
  tinytext: 1,
  text: 2,
  mediumtext: 3,
  longtext: 4
}

/**
 * Clones table structure (columns, text-type widening, indexes) from a source database
 * into a target database for a given set of tables, then baselines the target's
 * `schema_migrations` ledger to the source via {@link MigrationsLedger}. This is the
 * mechanism multi-tenant apps use to provision a tenant database from a template/global
 * database without re-running migrations: the structure is copied and the ledger is
 * recorded as already-applied, so a later `db:tenants:migrate` does not re-run an
 * `addColumn` whose column already exists.
 *
 * The cloner is intentionally policy-free — the caller decides which tables to sync and
 * which databases are source/target. It is idempotent: missing tables are created,
 * missing columns added, too-narrow text columns widened, and missing indexes created;
 * an index whose definition diverges from the source is treated as drift and throws.
 */
export default class SchemaCloner {
  /**
   * Creates a cloner that copies table structure from `sourceDb` into `targetDb`.
   * @param {{sourceDb: import("../drivers/base.js").default, targetDb: import("../drivers/base.js").default}} args
   */
  constructor({sourceDb, targetDb}) {
    this.sourceDb = sourceDb
    this.targetDb = targetDb
  }

  /**
   * Clones every given table from the source into the target, then baselines the
   * target's ledger so the cloned schema is recorded as already-migrated.
   * @param {string[]} tableNames
   * @returns {Promise<void>}
   */
  async syncTables(tableNames) {
    for (const tableName of tableNames) {
      await this.syncTable(tableName)
    }

    await this.reconcileLedger()
  }

  /**
   * Clones a single table from the source into the target, creating it or adding and
   * widening columns and indexes as needed.
   * @param {string} tableName
   * @returns {Promise<void>}
   */
  async syncTable(tableName) {
    const sourceTable = await this.sourceDb.getTableByName(tableName)

    if (!sourceTable) {
      throw new Error(`Expected source table to exist: ${tableName}`)
    }

    if (!await this.targetDb.tableExists(tableName)) {
      await this.createTargetTable({sourceTable, tableName})
      return
    }

    const changedColumns = await this.ensureTargetColumns({sourceTable, tableName})

    if (changedColumns) {
      this.targetDb.clearSchemaCache()
    }

    await this.ensureTargetIndexes({sourceTable, tableName})
  }

  /**
   * Creates the table in the target from the source table's columns and its
   * non-primary-key indexes.
   * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args
   * @returns {Promise<void>}
   */
  async createTargetTable({sourceTable, tableName}) {
    const tableData = new TableData(tableName)

    for (const sourceColumn of await sourceTable.getColumns()) {
      tableData.addColumn(sourceColumn.getName(), this.columnArgsFromSourceColumn(sourceColumn, {isNewColumn: false}))
    }

    for (const sourceIndex of await sourceTable.getIndexes()) {
      if (!sourceIndex.isPrimaryKey()) {
        tableData.addIndex(this.tableDataIndexFromSourceIndex(sourceIndex))
      }
    }

    await this.targetDb.createTable(tableData)
    this.targetDb.clearSchemaCache()
  }

  /**
   * Adds columns present on the source but missing from the target, and widens
   * too-narrow target text columns.
   * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args
   * @returns {Promise<boolean>} Whether any column was added or widened.
   */
  async ensureTargetColumns({sourceTable, tableName}) {
    const sourceColumns = await sourceTable.getColumns()
    const targetTable = await this.targetDb.getTableByNameOrFail(tableName)
    const targetColumnsByName = new Map()
    const missingColumns = []
    const columnsNeedingWidening = []

    for (const targetColumn of await targetTable.getColumns()) {
      targetColumnsByName.set(targetColumn.getName(), targetColumn)
    }

    for (const sourceColumn of sourceColumns) {
      const targetColumn = targetColumnsByName.get(sourceColumn.getName())

      if (!targetColumn) {
        missingColumns.push(sourceColumn)
      } else if (this.columnNeedsWidening(sourceColumn, targetColumn)) {
        columnsNeedingWidening.push(sourceColumn)
      }
    }

    if (missingColumns.length <= 0 && columnsNeedingWidening.length <= 0) {
      return false
    }

    const tableData = new TableData(tableName)

    for (const sourceColumn of missingColumns) {
      tableData.addColumn(sourceColumn.getName(), this.columnArgsFromSourceColumn(sourceColumn, {isNewColumn: true}))
    }

    for (const sourceColumn of columnsNeedingWidening) {
      tableData.addColumn(sourceColumn.getName(), this.columnArgsFromSourceColumn(sourceColumn, {isNewColumn: false}))
    }

    for (const alterSql of await this.targetDb.alterTableSQLs(tableData)) {
      await this.targetDb.query(alterSql)
    }

    return true
  }

  /**
   * Creates non-primary-key indexes present on the source but missing from the target,
   * and replaces target indexes whose definition (columns or uniqueness) drifted from
   * the source.
   * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args
   * @returns {Promise<void>}
   */
  async ensureTargetIndexes({sourceTable, tableName}) {
    const targetTable = await this.targetDb.getTableByNameOrFail(tableName)
    /** @type {Map<string, import("../drivers/base-columns-index.js").default>} */
    const targetIndexesByName = new Map()
    const targetIndexSignatures = new Set()
    let dirty = false

    for (const targetIndex of await targetTable.getIndexes()) {
      targetIndexesByName.set(targetIndex.getName(), targetIndex)
      targetIndexSignatures.add(this.indexSignature(targetIndex))
    }

    for (const sourceIndex of await sourceTable.getIndexes()) {
      if (sourceIndex.isPrimaryKey()) {
        continue
      }

      const sourceIndexSignature = this.indexSignature(sourceIndex)

      // SQLite index names are unique per-database, not per-table, so match cloned
      // indexes by their column/uniqueness signature rather than their name.
      if (this.targetDb.getType() === "sqlite" && targetIndexSignatures.has(sourceIndexSignature)) {
        continue
      }

      const targetIndex = this.targetDb.getType() === "sqlite" ? undefined : targetIndexesByName.get(sourceIndex.getName())

      if (targetIndex) {
        if (!this.indexesMatch(sourceIndex, targetIndex)) {
          // Replacing a non-unique index with a unique one is unsafe because
          // the target may have duplicate values that will reject the new
          // unique constraint, and the old index was already dropped by this
          // point. The opposite direction (unique → non-unique) is always
          // safe — non-unique indexes never fail on duplicate values.
          if (sourceIndex.isUnique() && !targetIndex.isUnique()) {
            throw new Error(`Schema clone index drift for ${tableName}.${sourceIndex.getName()}: cannot safely replace a non-unique index with a unique one.`)
          }

          await this.dropTargetIndex({tableName, targetIndex})
          targetIndexesByName.delete(targetIndex.getName())
          targetIndexSignatures.delete(this.indexSignature(targetIndex))
        } else {
          continue
        }
      }

      // Drop any target index that shares the source name but survived the
      // drift check above because the driver was skipped (SQLite).
      const sameNameTargetIndex = targetIndexesByName.get(sourceIndex.getName())

      if (sameNameTargetIndex) {
        await this.dropTargetIndex({tableName, targetIndex: sameNameTargetIndex})
        targetIndexesByName.delete(sameNameTargetIndex.getName())
        targetIndexSignatures.delete(this.indexSignature(sameNameTargetIndex))
      }

      const createIndexSqls = await this.targetDb.createIndexSQLs(this.createIndexArgsFromSourceIndex({sourceIndex, tableName}))

      for (const createIndexSql of createIndexSqls) {
        await this.targetDb.query(createIndexSql)
      }

      dirty = true
      targetIndexSignatures.add(sourceIndexSignature)
    }

    if (dirty) {
      this.targetDb.clearSchemaCache()
    }
  }

  /**
   * Drops an index on the target database.
   * @param {{tableName: string, targetIndex: import("../drivers/base-columns-index.js").default}} args
   * @returns {Promise<void>}
   */
  async dropTargetIndex({tableName, targetIndex}) {
    const dropSqls = await this.targetDb.removeIndexSQLs({name: targetIndex.getName(), tableName})

    for (const sql of dropSqls) {
      await this.targetDb.query(sql)
    }
  }

  /**
   * Baselines the target ledger so the cloned schema is recorded as already-applied.
   * @returns {Promise<string[]>} The versions newly recorded on the target.
   */
  async reconcileLedger() {
    return await MigrationsLedger.baselineFromDatabase({sourceDb: this.sourceDb, targetDb: this.targetDb})
  }

  /**
   * Whether the target ledger is missing any version applied on the source — i.e. the
   * target schema may have been advanced out of band without recording it.
   * @returns {Promise<boolean>}
   */
  async ledgerDriftsFromSource() {
    if (!await MigrationsLedger.tableExists(this.targetDb)) {
      return true
    }

    const sourceVersions = await MigrationsLedger.appliedVersions(this.sourceDb)
    const targetVersionSet = new Set(await MigrationsLedger.appliedVersions(this.targetDb))

    return sourceVersions.some((version) => !targetVersionSet.has(version))
  }

  /**
   * Maps a source index into a TableData index for table creation (SQLite omits the
   * index name so the driver can generate a unique one).
   * @param {import("../drivers/base-columns-index.js").default} sourceIndex
   * @returns {TableIndex}
   */
  tableDataIndexFromSourceIndex(sourceIndex) {
    /** @type {{name?: string, unique: boolean}} */
    const args = {unique: sourceIndex.isUnique()}

    // SQLite index names are unique per-database, not per-table, so let the driver
    // generate one; other drivers preserve the source index name. Build the TableIndex
    // directly (rather than via the driver's getTableDataIndex, which only MySQL and
    // SQLite implement) so cloning a PostgreSQL or MS-SQL source table works too.
    if (this.targetDb.getType() !== "sqlite") {
      args.name = sourceIndex.getName()
    }

    return new TableIndex(sourceIndex.getColumnNames(), args)
  }

  /**
   * Builds driver create-index args from a source index (the index name is omitted on
   * SQLite, where index names are unique per-database rather than per-table).
   * @param {{sourceIndex: import("../drivers/base-columns-index.js").default, tableName: string}} args
   * @returns {{columns: string[], name?: string, tableName: string, unique: boolean}}
   */
  createIndexArgsFromSourceIndex({sourceIndex, tableName}) {
    /** @type {{columns: string[], name?: string, tableName: string, unique: boolean}} */
    const createIndexArgs = {
      columns: sourceIndex.getColumnNames(),
      tableName,
      unique: sourceIndex.isUnique()
    }

    if (this.targetDb.getType() !== "sqlite") {
      createIndexArgs.name = sourceIndex.getName()
    }

    return createIndexArgs
  }

  /**
   * Whether two indexes have the same uniqueness and ordered column list.
   * @param {import("../drivers/base-columns-index.js").default} sourceIndex
   * @param {import("../drivers/base-columns-index.js").default} targetIndex
   * @returns {boolean}
   */
  indexesMatch(sourceIndex, targetIndex) {
    const sourceColumnNames = sourceIndex.getColumnNames()
    const targetColumnNames = targetIndex.getColumnNames()

    if (sourceIndex.isUnique() !== targetIndex.isUnique()) {
      return false
    }

    if (sourceColumnNames.length !== targetColumnNames.length) {
      return false
    }

    for (let columnIndex = 0; columnIndex < sourceColumnNames.length; columnIndex++) {
      if (sourceColumnNames[columnIndex] !== targetColumnNames[columnIndex]) {
        return false
      }
    }

    return true
  }

  /**
   * A stable signature for an index, used to match cloned indexes by shape.
   * @param {import("../drivers/base-columns-index.js").default} index
   * @returns {string}
   */
  indexSignature(index) {
    return `${index.isUnique() ? "unique" : "index"}:${index.getColumnNames().join(",")}`
  }

  /**
   * Normalizes a column type to its canonical lowercase form (`int` becomes `integer`).
   * @param {string} columnType
   * @returns {string}
   */
  normalizedColumnType(columnType) {
    const normalizedType = columnType.toLowerCase()

    if (normalizedType === "int") {
      return "integer"
    }

    return normalizedType
  }

  /**
   * The widening rank of a text column type (0 when not a text type).
   * @param {string} columnType
   * @returns {number}
   */
  textTypeRank(columnType) {
    return TEXT_TYPE_RANKS[this.normalizedColumnType(columnType)] || 0
  }

  /**
   * Whether the target's text column is narrower than the source's and must be widened.
   * @param {import("../drivers/base-column.js").default} sourceColumn
   * @param {import("../drivers/base-column.js").default} targetColumn
   * @returns {boolean}
   */
  columnNeedsWidening(sourceColumn, targetColumn) {
    const sourceRank = this.textTypeRank(sourceColumn.getType())
    const targetRank = this.textTypeRank(targetColumn.getType())

    return sourceRank > 0 && targetRank > 0 && sourceRank > targetRank
  }

  /**
   * Builds TableData column args from a source column, copying type, nullability,
   * length, notes, simple defaults and (for full clones) primary-key flag.
   * @param {import("../drivers/base-column.js").default} sourceColumn
   * @param {{isNewColumn: boolean}} args
   * @returns {Record<string, unknown>}
   */
  columnArgsFromSourceColumn(sourceColumn, {isNewColumn}) {
    /** @type {{autoIncrement?: boolean, default?: unknown, isNewColumn: boolean, maxLength?: number, notes?: string, null: boolean, primaryKey?: boolean, type: string}} */
    const columnArgs = {
      isNewColumn,
      null: sourceColumn.getNull(),
      type: this.normalizedColumnType(sourceColumn.getType())
    }
    const defaultValue = sourceColumn.getDefault()
    const maxLength = sourceColumn.getMaxLength()
    const notes = sourceColumn.getNotes()

    if (!isNewColumn && sourceColumn.getPrimaryKey()) {
      columnArgs.primaryKey = true
    }

    if (sourceColumn.getAutoIncrement()) {
      columnArgs.autoIncrement = true
    }

    // A maxLength of -1 is the MS-SQL "max" sentinel (NVARCHAR(MAX) / VARBINARY(MAX),
    // backing Velocious text/json/blob columns); the column type drives the unbounded
    // SQL, so don't forward -1 as an explicit length (it would emit NVARCHAR(-1)).
    if (maxLength !== undefined && maxLength >= 0) {
      columnArgs.maxLength = maxLength
    }

    if (notes) {
      columnArgs.notes = notes
    }

    if (defaultValue !== null && defaultValue !== undefined && SIMPLE_DEFAULT_PATTERN.test(String(defaultValue))) {
      columnArgs.default = defaultValue
    }

    return columnArgs
  }
}
