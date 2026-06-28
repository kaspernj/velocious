// @ts-check

const DEFAULT_INSERT_CHUNK_SIZE = 100
const DEFAULT_QUERY_CHUNK_SIZE = 500

/**
 * Splits an array into chunks of at most `chunkSize` items.
 * @template T
 * @param {T[]} values
 * @param {number} chunkSize
 * @returns {T[][]}
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
 * @param {unknown[]} values
 * @returns {string[]}
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
 * The copy is delete-then-reinsert and therefore idempotent: for every table touched by
 * the plan the matching target rows are deleted (children first) and the freshly loaded
 * source rows inserted (parents first), all inside one target transaction with foreign-key
 * enforcement disabled so the ordering never trips a constraint. Reads, deletes and inserts
 * are chunked to bound statement size.
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
   * }} args
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
   * returns the loaded rows keyed by table name. Deletes (children first) and inserts
   * (parents first) run in a single target transaction with foreign keys disabled.
   * @param {string} keyValue
   * @returns {Promise<Map<string, Record<string, unknown>[]>>}
   */
  async copy(keyValue) {
    const rowsByTableName = await this.loadRows(keyValue)

    await this.targetDb.withDisabledForeignKeys(async () => {
      await this.targetDb.transaction(async () => {
        await this.deleteTargetRows(rowsByTableName)
        await this.insertTargetRows(rowsByTableName)
      })
    })

    return rowsByTableName
  }

  /**
   * Loads the source rows for `keyValue` for every table in the plan, resolving
   * parent-scoped tables from the ids already selected for their parent table.
   * @param {string} keyValue
   * @returns {Promise<Map<string, Record<string, unknown>[]>>}
   */
  async loadRows(keyValue) {
    /** @type {Map<string, string[]>} */
    const idsByTableName = new Map()
    /** @type {Map<string, Record<string, unknown>[]>} */
    const rowsByTableName = new Map()

    for (const tableConfig of this.tablePlan) {
      let rows

      if (tableConfig.keyColumn) {
        rows = await this.queryRowsByColumn({
          columnName: tableConfig.keyColumn,
          tableName: tableConfig.tableName,
          values: [keyValue]
        })
      } else {
        if (!tableConfig.parentColumn || !tableConfig.parentTableName) {
          throw new Error(`Expected keyColumn or parentTableName+parentColumn for table ${tableConfig.tableName} in the tenant table plan.`)
        }

        const parentIds = idsByTableName.get(tableConfig.parentTableName) || []

        rows = await this.queryRowsByColumn({
          columnName: tableConfig.parentColumn,
          tableName: tableConfig.tableName,
          values: parentIds
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
   * Selects all source rows of `tableName` whose `columnName` is in `values`, chunked.
   * @param {{columnName: string, tableName: string, values: string[]}} args
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async queryRowsByColumn({columnName, tableName, values}) {
    const normalizedValues = uniqueStrings(values)

    if (normalizedValues.length <= 0) {
      return []
    }

    const rows = []
    const quotedTable = this.sourceDb.quoteTable(tableName)
    const quotedColumn = this.sourceDb.quoteColumn(columnName)

    for (const valuesChunk of chunks(normalizedValues, this.queryChunkSize)) {
      const sql = `SELECT ${quotedTable}.* FROM ${quotedTable} WHERE ${quotedColumn} IN (${this.quotedValuesSql(this.sourceDb, valuesChunk)})`

      rows.push(...await this.executeQuietQuery(this.sourceDb, sql))
    }

    return rows
  }

  /**
   * Deletes the matching target rows for every plan table, children before parents, so the
   * reinsert that follows starts from a clean slate without violating foreign keys.
   * @param {Map<string, Record<string, unknown>[]>} rowsByTableName
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
   * @param {Map<string, Record<string, unknown>[]>} rowsByTableName
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
   * @param {import("../drivers/base.js").default} db
   * @param {string[]} values
   * @returns {string}
   */
  quotedValuesSql(db, values) {
    return values.map((value) => db.quote(value)).join(", ")
  }

  /**
   * Runs a query without per-query logging, used for the high-volume copy statements.
   * @param {import("../drivers/base.js").default} db
   * @param {string} sql
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async executeQuietQuery(db, sql) {
    return await db.query(sql, {logQuery: false})
  }

  /**
   * Inserts column-aligned row tuples into a table without per-query logging.
   * @param {{columns: string[], db: import("../drivers/base.js").default, rows: Array<Array<unknown>>, tableName: string}} args
   * @returns {Promise<void>}
   */
  async insertRowsQuietly({columns, db, rows, tableName}) {
    await this.executeQuietQuery(db, db.insertSql({columns, tableName, rows}))
  }

  /**
   * Forwards a progress message to the optional `onProgress` callback when one was given.
   * @param {string} message
   * @returns {void}
   */
  reportProgress(message) {
    if (this.onProgress) {
      this.onProgress(message)
    }
  }
}
