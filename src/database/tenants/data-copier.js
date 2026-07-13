// @ts-check

const DEFAULT_INSERT_CHUNK_SIZE = 100
const DEFAULT_QUERY_CHUNK_SIZE = 500

/**
 * Splits an array into chunks of at most `chunkSize` items.
 * @template T
 * @param {T[]} values - Values to process.
 * @param {number} chunkSize - Maximum chunk size.
 * @returns {T[][]} - Values divided into bounded chunks.
 */
function chunks(values, chunkSize) {
  const chunkedValues = []

  for (let index = 0; index < values.length; index += chunkSize) {
    chunkedValues.push(values.slice(index, index + chunkSize))
  }

  return chunkedValues
}

/**
 * Stringifies values and returns the distinct, non-blank ones, preserving first-seen order.
 * @param {unknown[]} values - Values to process.
 * @returns {string[]} - Deduplicated string values.
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value)).filter((value) => value.trim())))
}

/**
 * Copies a single tenant's rows from a source database into a target database, following a
 * table plan that partitions each table either by a direct tenant key column or by
 * parent-id traversal. This is the row-level counterpart to schema cloning: multi-tenant
 * apps that keep each tenant's data in its own database use it to (re)materialise the
 * tenant's rows from a global/template database.
 *
 * The copy is delete-then-reinsert and therefore idempotent, and it mirrors the source
 * snapshot: the rows to delete are the tenant's *current* rows in the target (selected with
 * the same plan traversal run against the target), so a row that was removed from the source
 * since the last copy is dropped from the target too rather than lingering. The deletes run
 * children first and the source inserts parents first, all inside one target transaction with
 * foreign-key enforcement disabled so the ordering never trips a constraint. Reads, deletes
 * and inserts are chunked to bound statement size.
 *
 * The copier is policy-free: the caller supplies the plan, the source/target databases and
 * the tenant key, and {@link DataCopier#copy} returns the loaded rows keyed by table name so
 * the caller can perform any app-specific post-copy work (for example registering record
 * locations) without that policy leaking into the framework.
 */
export default class DataCopier {
  /**
   * Creates a copier that moves tenant-owned rows from `sourceDb` into `targetDb`.
   * @param {{
   *   sourceDb: import("../drivers/base.js").default,
   *   targetDb: import("../drivers/base.js").default,
   *   tablePlan: import("./tenant-table-plan.js").TenantTablePlanEntry[],
   *   idColumn?: string,
   *   insertChunkSize?: number,
   *   queryChunkSize?: number,
   *   onProgress?: (message: string) => void
   * }} args - Options.
   */
  constructor({sourceDb, targetDb, tablePlan, idColumn = "id", insertChunkSize = DEFAULT_INSERT_CHUNK_SIZE, queryChunkSize = DEFAULT_QUERY_CHUNK_SIZE, onProgress}) {
    this.sourceDb = sourceDb
    this.targetDb = targetDb
    this.tablePlan = tablePlan
    this.idColumn = idColumn
    this.insertChunkSize = insertChunkSize
    this.queryChunkSize = queryChunkSize
    this.onProgress = onProgress
  }

  /**
   * Copies every plan table's rows for `keyValue` from the source into the target and
   * returns the copied source rows keyed by table name. The target's current tenant rows
   * are deleted (children first) and the source rows inserted (parents first) in a single
   * target transaction with foreign keys disabled.
   * @param {string} keyValue - Key value.
   * @returns {Promise<Map<string, Record<string, unknown>[]>>} - Copied source rows grouped by table name.
   */
  async copy(keyValue) {
    const sourceRowsByTableName = await this.loadRows(this.sourceDb, keyValue)
    const targetRowsByTableName = await this.loadRows(this.targetDb, keyValue)

    await this.targetDb.withDisabledForeignKeys(async () => {
      await this.targetDb.transaction(async () => {
        await this.deleteTargetRows(targetRowsByTableName)
        await this.insertTargetRows(sourceRowsByTableName)
      })
    })

    return sourceRowsByTableName
  }

  /**
   * Deletes one tenant's rows from the target database, children before parents, with
   * foreign keys disabled inside a single transaction. This is `copy` without the reinsert:
   * the same plan traversal selects the tenant's current target rows and `deleteTargetRows`
   * removes them children-first so the ordering never trips a foreign key. Multi-tenant apps
   * use it to purge a tenant — for example clearing the tenant's master copy in the
   * global/default database on teardown, so foreign keys stop referencing the tenant's
   * about-to-be-removed root row.
   *
   * Returns the deleted rows keyed by table name so the caller can perform any app-specific
   * post-delete work (record-location cleanup, auditing) without that policy leaking into the
   * framework.
   * @param {string} keyValue - Tenant key whose rows should be removed from the target.
   * @returns {Promise<Map<string, Record<string, unknown>[]>>} - The deleted rows by table name.
   */
  async deleteTenantRows(keyValue) {
    const rowsByTableName = await this.loadRows(this.targetDb, keyValue)

    await this.targetDb.withDisabledForeignKeys(async () => {
      await this.targetDb.transaction(async () => {
        await this.deleteTargetRows(rowsByTableName)
      })
    })

    return rowsByTableName
  }

  /**
   * Loads the rows for `keyValue` for every table in the plan from `db`, resolving
   * parent-scoped tables from the ids already selected for their parent table. Used for
   * both the source rows to copy and the target's current tenant rows to delete.
   * @param {import("../drivers/base.js").default} db - Database connection.
   * @param {string} keyValue - Key value.
   * @returns {Promise<Map<string, Record<string, unknown>[]>>} - Loaded rows grouped by table name.
   */
  async loadRows(db, keyValue) {
    /** @type {Map<string, string[]>} */
    const idsByTableName = new Map()
    /** @type {Map<string, Record<string, unknown>[]>} */
    const rowsByTableName = new Map()

    for (const tableConfig of this.tablePlan) {
      let rows

      if (tableConfig.keyColumn) {
        rows = await this.queryRowsByColumn({
          columnName: tableConfig.keyColumn,
          db,
          tableName: tableConfig.tableName,
          values: [keyValue]
        })
      } else {
        if (!tableConfig.parentColumn || !tableConfig.parentTableName) {
          throw new Error(`Expected keyColumn or parentTableName+parentColumn for table ${tableConfig.tableName} in the tenant table plan.`)
        }

        if (!idsByTableName.has(tableConfig.parentTableName)) {
          throw new Error(`Tenant table plan entry ${tableConfig.tableName} references parent table ${tableConfig.parentTableName}, which has not been loaded; parent tables must appear before their children in the plan.`)
        }

        rows = await this.queryRowsByColumn({
          columnName: tableConfig.parentColumn,
          db,
          tableName: tableConfig.tableName,
          values: idsByTableName.get(tableConfig.parentTableName) || []
        })
      }

      if (rows.length > 0) {
        this.reportProgress(`${tableConfig.tableName}: loaded ${rows.length} row(s)`)
      }

      idsByTableName.set(tableConfig.tableName, uniqueStrings(rows.map((row) => row[this.idColumn])))
      rowsByTableName.set(tableConfig.tableName, rows)
    }

    return rowsByTableName
  }

  /**
   * Selects all rows of `tableName` in `db` whose `columnName` is in `values`, chunked.
   * @param {{columnName: string, db: import("../drivers/base.js").default, tableName: string, values: string[]}} args - Options.
   * @returns {Promise<Record<string, unknown>[]>} - Rows matching the supplied column values.
   */
  async queryRowsByColumn({columnName, db, tableName, values}) {
    const normalizedValues = uniqueStrings(values)

    if (normalizedValues.length <= 0) {
      return []
    }

    const rows = []
    const quotedTable = db.quoteTable(tableName)
    const quotedColumn = db.quoteColumn(columnName)

    for (const valuesChunk of chunks(normalizedValues, this.queryChunkSize)) {
      const sql = `SELECT ${quotedTable}.* FROM ${quotedTable} WHERE ${quotedColumn} IN (${this.quotedValuesSql(db, valuesChunk)})`

      rows.push(...await this.executeQuietQuery(db, sql))
    }

    return rows
  }

  /**
   * Deletes the matching target rows for every plan table, children before parents, so the
   * reinsert that follows starts from a clean slate without violating foreign keys.
   * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
   * @returns {Promise<void>}
   */
  async deleteTargetRows(rowsByTableName) {
    for (const tableConfig of [...this.tablePlan].reverse()) {
      const rowIds = uniqueStrings((rowsByTableName.get(tableConfig.tableName) || []).map((row) => row[this.idColumn]))

      if (rowIds.length <= 0) {
        continue
      }

      const quotedTable = this.targetDb.quoteTable(tableConfig.tableName)
      const quotedIdColumn = this.targetDb.quoteColumn(this.idColumn)

      for (const rowIdsChunk of chunks(rowIds, this.queryChunkSize)) {
        await this.executeQuietQuery(
          this.targetDb,
          `DELETE FROM ${quotedTable} WHERE ${quotedIdColumn} IN (${this.quotedValuesSql(this.targetDb, rowIdsChunk)})`
        )
      }
    }
  }

  /**
   * Inserts the loaded source rows into the target for every plan table, parents before
   * children, chunked to bound statement size.
   * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
   * @returns {Promise<void>}
   */
  async insertTargetRows(rowsByTableName) {
    for (const tableConfig of this.tablePlan) {
      const rows = rowsByTableName.get(tableConfig.tableName) || []

      if (rows.length <= 0) {
        continue
      }

      const columns = Object.keys(rows[0])
      const insertChunks = chunks(rows, this.insertChunkSize)

      this.reportProgress(`${tableConfig.tableName}: inserting ${rows.length} row(s) in ${insertChunks.length} chunk(s)`)

      for (const rowsChunk of insertChunks) {
        await this.insertRowsQuietly({
          columns,
          db: this.targetDb,
          rows: rowsChunk.map((row) => columns.map((column) => row[column])),
          tableName: tableConfig.tableName
        })
      }
    }
  }

  /**
   * Quotes and comma-joins values for an SQL `IN (...)` list against the given database.
   * @param {import("../drivers/base.js").default} db - Database connection.
   * @param {string[]} values - Values to process.
   * @returns {string} - Quoted SQL value list.
   */
  quotedValuesSql(db, values) {
    return values.map((value) => db.quote(value)).join(", ")
  }

  /**
   * Runs a query without per-query logging, used for the high-volume copy statements.
   * @param {import("../drivers/base.js").default} db - Database connection.
   * @param {string} sql - SQL statement.
   * @returns {Promise<Record<string, unknown>[]>} - Query result rows.
   */
  async executeQuietQuery(db, sql) {
    return await db.query(sql, {logQuery: false})
  }

  /**
   * Inserts column-aligned row tuples into a table without per-query logging.
   * @param {{columns: string[], db: import("../drivers/base.js").default, rows: Array<Array<unknown>>, tableName: string}} args - Options.
   * @returns {Promise<void>}
   */
  async insertRowsQuietly({columns, db, rows, tableName}) {
    await this.executeQuietQuery(db, db.insertSql({columns, tableName, rows}))
  }

  /**
   * Forwards a progress message to the optional `onProgress` callback when one was given.
   * @param {string} message - Message to process.
   * @returns {void}
   */
  reportProgress(message) {
    if (this.onProgress) {
      this.onProgress(message)
    }
  }
}
