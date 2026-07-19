// @ts-check

const DEFAULT_INSERT_CHUNK_SIZE = 100
const DEFAULT_QUERY_CHUNK_SIZE = 500
const DEFAULT_STREAM_BATCH_SIZE = 1000

/**
 * Splits an array into chunks of at most `chunkSize` items.
 * @template T
 * @param {T[]} values - Ordered items to partition.
 * @param {number} chunkSize - Maximum items per chunk.
 * @returns {T[][]} - Consecutive chunks preserving input order.
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
 * @param {unknown[]} values - Candidate database identifiers to stringify and deduplicate.
 * @returns {string[]} - Distinct non-blank identifiers in first-seen order.
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
   * }} args - Source, target, traversal plan, chunk limits, and progress handler.
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
   * @param {string} keyValue - Tenant key selecting the rows to copy.
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
   * @param {import("../drivers/base.js").default} db - Source or target database to traverse.
   * @param {string} keyValue - Tenant key selecting the root plan rows.
   * @returns {Promise<Map<string, Record<string, unknown>[]>>} - Loaded rows grouped by table name.
   */
  async loadRows(db, keyValue) {
    return (await this.traversePlan(db, keyValue)).rowsByTableName
  }

  /**
   * Loads only the ids for `keyValue` for every table in the plan from `db`, using the same
   * parent/child traversal as {@link DataCopier#loadRows} but selecting just the id column.
   * Callers that only need to compare row membership — for example verifying a tenant already
   * holds every default row before a cleanup delete — should use this instead of loadRows so
   * they never materialise full rows; for large tenants that is the difference between a few
   * kilobytes of ids and gigabytes of row data.
   * @param {import("../drivers/base.js").default} db - Source or target database to traverse.
   * @param {string} keyValue - Tenant key selecting the root plan rows.
   * @returns {Promise<Map<string, string[]>>} - Loaded ids grouped by table name.
   */
  async loadRowIds(db, keyValue) {
    return (await this.traversePlan(db, keyValue, [this.idColumn])).idsByTableName
  }

  /**
   * Traverses the table plan for `keyValue`, querying each table by its tenant key column or
   * (for child tables) by the ids already selected for its parent, and returns both the ids
   * and the loaded rows grouped by table name. `selectColumns` bounds the columns each query
   * selects; pass `[idColumn]` for an id-only traversal, or omit it to load full rows.
   * @param {import("../drivers/base.js").default} db - Source or target database to traverse.
   * @param {string} keyValue - Tenant key selecting the root plan rows.
   * @param {string[]} [selectColumns] - Columns to select; defaults to every column.
   * @returns {Promise<{idsByTableName: Map<string, string[]>, rowsByTableName: Map<string, Record<string, unknown>[]>}>} - Ids and rows grouped by table name.
   */
  async traversePlan(db, keyValue, selectColumns) {
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
          selectColumns,
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
          selectColumns,
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

    return {idsByTableName, rowsByTableName}
  }

  /**
   * The plan tables referenced as a parent by some child entry. Their ids must be retained
   * while streaming so their children can be scoped; leaf tables — typically the high-volume
   * ones — are never in this set and so are never accumulated in memory.
   * @returns {Set<string>} - Table names that are a parent of another plan entry.
   */
  parentTableNames() {
    /** @type {Set<string>} */
    const names = new Set()

    for (const tableConfig of this.tablePlan) {
      if (tableConfig.parentTableName) {
        names.add(tableConfig.parentTableName)
      }
    }

    return names
  }

  /**
   * Streams the source ids for every plan table scoped to `keyValue` in bounded `batchSize`
   * pages, following parent/child chaining. Each table's ids are read through a real
   * {@link import("../drivers/base.js").default#queryStream} cursor, so a large table is never
   * buffered; only the ids of tables that are themselves a parent are retained (to scope their
   * children). Memory stays bounded to one batch plus the retained parent-table ids.
   * @param {import("../drivers/base.js").default} db - Source database to stream.
   * @param {string} keyValue - Tenant key selecting the root plan rows.
   * @param {{batchSize: number}} options - Maximum ids per yielded batch.
   * @yields {{ids: string[], tableName: string}} - Successive id batches per table.
   */
  async *streamPlanSourceIdBatches(db, keyValue, {batchSize}) {
    /** @type {Map<string, string[]>} */
    const retainedIdsByTableName = new Map()
    const parentTableNames = this.parentTableNames()

    for (const tableConfig of this.tablePlan) {
      /** @type {string} */
      let scopeColumn
      /** @type {string[]} */
      let scopeValues

      if (tableConfig.keyColumn) {
        scopeColumn = tableConfig.keyColumn
        scopeValues = [keyValue]
      } else {
        if (!tableConfig.parentColumn || !tableConfig.parentTableName) {
          throw new Error(`Expected keyColumn or parentTableName+parentColumn for table ${tableConfig.tableName} in the tenant table plan.`)
        }

        if (!retainedIdsByTableName.has(tableConfig.parentTableName)) {
          throw new Error(`Tenant table plan entry ${tableConfig.tableName} references parent table ${tableConfig.parentTableName}, which has not been streamed; parent tables must appear before their children in the plan.`)
        }

        scopeColumn = tableConfig.parentColumn
        scopeValues = retainedIdsByTableName.get(tableConfig.parentTableName) || []
      }

      /** @type {string[] | null} */
      const retainedIds = parentTableNames.has(tableConfig.tableName) ? [] : null
      const quotedTable = db.quoteTable(tableConfig.tableName)
      const quotedId = db.quoteColumn(this.idColumn)
      const quotedScope = db.quoteColumn(scopeColumn)
      /** @type {string[]} */
      let batch = []

      for (const scopeChunk of chunks(uniqueStrings(scopeValues), this.queryChunkSize)) {
        const sql = `SELECT ${quotedTable}.${quotedId} FROM ${quotedTable} WHERE ${quotedScope} IN (${this.quotedValuesSql(db, scopeChunk)})`

        for await (const row of db.queryStream(sql)) {
          const id = String(row[this.idColumn])

          batch.push(id)

          if (retainedIds) {
            retainedIds.push(id)
          }

          if (batch.length >= batchSize) {
            yield {ids: batch, tableName: tableConfig.tableName}
            batch = []
          }
        }
      }

      if (batch.length > 0) {
        yield {ids: batch, tableName: tableConfig.tableName}
      }

      retainedIdsByTableName.set(tableConfig.tableName, retainedIds || [])
    }
  }

  /**
   * Returns which of `ids` currently exist in `tableName` in `db`. `ids` is one already-bounded
   * batch, so it is probed with a single `IN (...)` lookup.
   * @param {{db: import("../drivers/base.js").default, ids: string[], tableName: string}} args - Database, ids to probe, and table.
   * @returns {Promise<Set<string>>} - The subset of `ids` present in the table.
   */
  async queryExistingIds({db, ids, tableName}) {
    if (ids.length <= 0) {
      return new Set()
    }

    const quotedTable = db.quoteTable(tableName)
    const quotedId = db.quoteColumn(this.idColumn)
    const rows = await this.executeQuietQuery(db, `SELECT ${quotedTable}.${quotedId} FROM ${quotedTable} WHERE ${quotedId} IN (${this.quotedValuesSql(db, ids)})`)

    return new Set(rows.map((row) => String(row[this.idColumn])))
  }

  /**
   * Streams the source rows for `keyValue` and returns, per table, the ids present in the source
   * but missing from the target — without ever materialising a whole table. Callers verifying a
   * tenant already holds every source row (for example before deleting the source copies) treat
   * an empty result as the go-ahead. Memory stays bounded to one batch of ids plus the retained
   * parent-table ids, so it is safe on arbitrarily large tables.
   * @param {string} keyValue - Tenant key selecting the source rows to check.
   * @param {{batchSize?: number}} [options] - Streaming batch size.
   * @returns {Promise<Map<string, string[]>>} - Source ids missing from the target, grouped by table name.
   */
  async findMissingRowIds(keyValue, {batchSize = DEFAULT_STREAM_BATCH_SIZE} = {}) {
    /** @type {Map<string, string[]>} */
    const missingByTableName = new Map()

    for await (const {ids, tableName} of this.streamPlanSourceIdBatches(this.sourceDb, keyValue, {batchSize})) {
      const existingIds = await this.queryExistingIds({db: this.targetDb, ids, tableName})
      const missingIds = ids.filter((id) => !existingIds.has(id))

      if (missingIds.length > 0) {
        const tableMissing = missingByTableName.get(tableName) || []

        tableMissing.push(...missingIds)
        missingByTableName.set(tableName, tableMissing)
      }
    }

    return missingByTableName
  }

  /**
   * Streams the source rows for `keyValue` and copies into the target only the rows missing
   * there. Full rows are loaded solely for the (usually few) missing ids, after the id stream
   * has finished and released its source connection, so a table with large columns is never
   * fully materialised. Intended for single-table plans whose rows have no plan children.
   * @param {string} keyValue - Tenant key selecting the source rows to reconcile.
   * @param {{batchSize?: number}} [options] - Streaming batch size for the id scan.
   * @returns {Promise<number>} - The number of rows copied into the target.
   */
  async copyMissingRows(keyValue, {batchSize = DEFAULT_STREAM_BATCH_SIZE} = {}) {
    const missingByTableName = await this.findMissingRowIds(keyValue, {batchSize})
    let copiedCount = 0

    for (const [tableName, missingIds] of missingByTableName) {
      const missingRows = await this.queryRowsByColumn({columnName: this.idColumn, db: this.sourceDb, tableName, values: missingIds})

      await this.insertTargetRows(new Map([[tableName, missingRows]]))
      copiedCount += missingRows.length
    }

    return copiedCount
  }

  /**
   * Selects `tableName` rows in `db` whose `columnName` is in `values`, chunked. `selectColumns`
   * bounds the projection and defaults to every column.
   * @param {{columnName: string, db: import("../drivers/base.js").default, selectColumns?: string[], tableName: string, values: string[]}} args - Table, column, projection, database, and values for the chunked lookup.
   * @returns {Promise<Record<string, unknown>[]>} - Rows matching the supplied column values.
   */
  async queryRowsByColumn({columnName, db, selectColumns, tableName, values}) {
    const normalizedValues = uniqueStrings(values)

    if (normalizedValues.length <= 0) {
      return []
    }

    const rows = []
    const quotedTable = db.quoteTable(tableName)
    const quotedColumn = db.quoteColumn(columnName)
    const selectList = selectColumns
      ? selectColumns.map((column) => `${quotedTable}.${db.quoteColumn(column)}`).join(", ")
      : `${quotedTable}.*`

    for (const valuesChunk of chunks(normalizedValues, this.queryChunkSize)) {
      const sql = `SELECT ${selectList} FROM ${quotedTable} WHERE ${quotedColumn} IN (${this.quotedValuesSql(db, valuesChunk)})`

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
   * @param {import("../drivers/base.js").default} db - Database whose quoting rules format the values.
   * @param {string[]} values - Values to quote for the `IN` list.
   * @returns {string} - Quoted SQL value list.
   */
  quotedValuesSql(db, values) {
    return values.map((value) => db.quote(value)).join(", ")
  }

  /**
   * Runs a query without per-query logging, used for the high-volume copy statements.
   * @param {import("../drivers/base.js").default} db - Database on which to execute the copy query.
   * @param {string} sql - Copy-related SQL statement to execute quietly.
   * @returns {Promise<Record<string, unknown>[]>} - Query result rows.
   */
  async executeQuietQuery(db, sql) {
    return await db.query(sql, {logQuery: false})
  }

  /**
   * Inserts column-aligned row tuples into a table without per-query logging.
   * @param {{columns: string[], db: import("../drivers/base.js").default, rows: Array<Array<unknown>>, tableName: string}} args - Destination table and column-aligned row values to insert.
   * @returns {Promise<void>}
   */
  async insertRowsQuietly({columns, db, rows, tableName}) {
    await this.executeQuietQuery(db, db.insertSql({columns, tableName, rows}))
  }

  /**
   * Forwards a progress message to the optional `onProgress` callback when one was given.
   * @param {string} message - Copy progress message to forward when reporting is enabled.
   * @returns {void}
   */
  reportProgress(message) {
    if (this.onProgress) {
      this.onProgress(message)
    }
  }
}
