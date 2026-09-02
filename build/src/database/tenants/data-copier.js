// @ts-check
import { POOL_CONFIGURATION_KEY } from "../pool/base.js";
const DEFAULT_INSERT_CHUNK_SIZE = 100;
const DEFAULT_QUERY_CHUNK_SIZE = 500;
const DEFAULT_STREAM_BATCH_SIZE = 1000;
/**
 * Splits an array into chunks of at most `chunkSize` items.
 * @template T
 * @param {T[]} values - Ordered items to partition.
 * @param {number} chunkSize - Maximum items per chunk.
 * @returns {T[][]} - Consecutive chunks preserving input order.
 */
function chunks(values, chunkSize) {
    const chunkedValues = [];
    for (let index = 0; index < values.length; index += chunkSize) {
        chunkedValues.push(values.slice(index, index + chunkSize));
    }
    return chunkedValues;
}
/**
 * Stringifies values and returns the distinct, non-blank ones, preserving first-seen order.
 * @param {unknown[]} values - Candidate database identifiers to stringify and deduplicate.
 * @returns {string[]} - Distinct non-blank identifiers in first-seen order.
 */
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => String(value)).filter((value) => value.trim())));
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
    constructor({ sourceDb, targetDb, tablePlan, idColumn = "id", insertChunkSize = DEFAULT_INSERT_CHUNK_SIZE, queryChunkSize = DEFAULT_QUERY_CHUNK_SIZE, onProgress }) {
        this.sourceDb = sourceDb;
        this.targetDb = targetDb;
        this.tablePlan = tablePlan;
        this.idColumn = idColumn;
        this.insertChunkSize = insertChunkSize;
        this.queryChunkSize = queryChunkSize;
        this.onProgress = onProgress;
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
        const sourceRowsByTableName = await this.loadRows(this.sourceDb, keyValue);
        const targetRowsByTableName = await this.loadRows(this.targetDb, keyValue);
        await this.targetDb.withDisabledForeignKeys(async () => {
            await this.targetDb.transaction(async () => {
                await this.deleteTargetRows(targetRowsByTableName);
                await this.insertTargetRows(sourceRowsByTableName);
            });
        });
        return sourceRowsByTableName;
    }
    /**
     * Moves every plan table's rows for `keyValue` from the source into the target. The target
     * write commits before the source delete begins, so a target failure leaves the source
     * untouched and a source-delete failure can be retried safely. When the source no longer has
     * matching rows, the method returns the empty traversal without changing the target.
     *
     * `transformRow` can change target-only values such as a tenant ownership column. It receives
     * a shallow clone and must preserve the configured id column so retries address the same rows.
     * @param {string} keyValue - Tenant key selecting the rows to move.
     * @param {{transformRow?: (args: {row: Record<string, unknown>, tableName: string}) => Record<string, unknown>}} [options] - Optional target-row transformation.
     * @returns {Promise<Map<string, Record<string, unknown>[]>>} - Rows written to the target, grouped by table name.
     */
    async move(keyValue, { transformRow } = {}) {
        const sourceDbWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (this.sourceDb);
        const targetDbWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (this.targetDb);
        const sourceReuseKey = sourceDbWithPoolKey[POOL_CONFIGURATION_KEY];
        const targetReuseKey = targetDbWithPoolKey[POOL_CONFIGURATION_KEY];
        const sameResolvedDatabase = this.sourceDb.configuration === this.targetDb.configuration
            && sourceReuseKey !== undefined
            && sourceReuseKey === targetReuseKey;
        if (this.sourceDb === this.targetDb || sameResolvedDatabase) {
            throw new Error("DataCopier move requires different physical databases.");
        }
        const sourceRowsByTableName = await this.loadRows(this.sourceDb, keyValue);
        if (!this.rowsByTableNameHasRows(sourceRowsByTableName)) {
            return sourceRowsByTableName;
        }
        const targetRowsByTableName = this.transformRows({ rowsByTableName: sourceRowsByTableName, transformRow });
        await this.targetDb.withDisabledForeignKeys(async () => {
            await this.targetDb.transaction(async () => {
                await this.deleteRows({ db: this.targetDb, rowsByTableName: sourceRowsByTableName });
                await this.insertRows({ db: this.targetDb, rowsByTableName: targetRowsByTableName });
                await this.assertRowsExist({ db: this.targetDb, rowsByTableName: targetRowsByTableName });
            });
        });
        await this.sourceDb.withDisabledForeignKeys(async () => {
            await this.sourceDb.transaction(async () => {
                await this.deleteRows({ db: this.sourceDb, rowsByTableName: sourceRowsByTableName });
            });
        });
        return targetRowsByTableName;
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
        const rowsByTableName = await this.loadRows(this.targetDb, keyValue);
        await this.targetDb.withDisabledForeignKeys(async () => {
            await this.targetDb.transaction(async () => {
                await this.deleteTargetRows(rowsByTableName);
            });
        });
        return rowsByTableName;
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
        return (await this.traversePlan(db, keyValue)).rowsByTableName;
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
        return (await this.traversePlan(db, keyValue, [this.idColumn])).idsByTableName;
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
        const idsByTableName = new Map();
        /** @type {Map<string, Record<string, unknown>[]>} */
        const rowsByTableName = new Map();
        for (const tableConfig of this.tablePlan) {
            let rows;
            if (tableConfig.keyColumn) {
                rows = await this.queryRowsByColumn({
                    columnName: tableConfig.keyColumn,
                    db,
                    selectColumns,
                    tableName: tableConfig.tableName,
                    values: [keyValue]
                });
            }
            else {
                if (!tableConfig.parentColumn || !tableConfig.parentTableName) {
                    throw new Error(`Expected keyColumn or parentTableName+parentColumn for table ${tableConfig.tableName} in the tenant table plan.`);
                }
                if (!idsByTableName.has(tableConfig.parentTableName)) {
                    throw new Error(`Tenant table plan entry ${tableConfig.tableName} references parent table ${tableConfig.parentTableName}, which has not been loaded; parent tables must appear before their children in the plan.`);
                }
                rows = await this.queryRowsByColumn({
                    columnName: tableConfig.parentColumn,
                    db,
                    selectColumns,
                    tableName: tableConfig.tableName,
                    values: idsByTableName.get(tableConfig.parentTableName) || []
                });
            }
            if (rows.length > 0) {
                this.reportProgress(`${tableConfig.tableName}: loaded ${rows.length} row(s)`);
            }
            idsByTableName.set(tableConfig.tableName, uniqueStrings(rows.map((row) => row[this.idColumn])));
            rowsByTableName.set(tableConfig.tableName, rows);
        }
        return { idsByTableName, rowsByTableName };
    }
    /**
     * The plan tables referenced as a parent by some child entry. Their ids must be retained
     * while streaming so their children can be scoped; leaf tables — typically the high-volume
     * ones — are never in this set and so are never accumulated in memory.
     * @returns {Set<string>} - Table names that are a parent of another plan entry.
     */
    parentTableNames() {
        /** @type {Set<string>} */
        const names = new Set();
        for (const tableConfig of this.tablePlan) {
            if (tableConfig.parentTableName) {
                names.add(tableConfig.parentTableName);
            }
        }
        return names;
    }
    /**
     * Streams every plan table's source rows scoped to `keyValue` in bounded `batchSize` batches,
     * following parent/child chaining. Each table is read through a real
     * {@link import("../drivers/base.js").default#queryStream} cursor, so a large table is never
     * buffered; only the ids of tables that are themselves a parent are retained (to scope their
     * children). `selectColumns` bounds each row's projection — pass `[idColumn]` for a light
     * id-only scan, or omit it to stream full rows — and must include the id column for any table
     * that has children. Memory stays bounded to one batch plus the retained parent-table ids.
     * @param {import("../drivers/base.js").default} db - Source database to stream.
     * @param {string} keyValue - Tenant key selecting the root plan rows.
     * @param {{batchSize: number, selectColumns?: string[]}} options - Batch size and optional projection.
     * @yields {{rows: Record<string, unknown>[], tableName: string}} - Successive row batches per table.
     */
    async *streamPlanSourceBatches(db, keyValue, { batchSize, selectColumns }) {
        /** @type {Map<string, string[]>} */
        const retainedIdsByTableName = new Map();
        const parentTableNames = this.parentTableNames();
        for (const tableConfig of this.tablePlan) {
            /** @type {string} */
            let scopeColumn;
            /** @type {string[]} */
            let scopeValues;
            if (tableConfig.keyColumn) {
                scopeColumn = tableConfig.keyColumn;
                scopeValues = [keyValue];
            }
            else {
                if (!tableConfig.parentColumn || !tableConfig.parentTableName) {
                    throw new Error(`Expected keyColumn or parentTableName+parentColumn for table ${tableConfig.tableName} in the tenant table plan.`);
                }
                if (!retainedIdsByTableName.has(tableConfig.parentTableName)) {
                    throw new Error(`Tenant table plan entry ${tableConfig.tableName} references parent table ${tableConfig.parentTableName}, which has not been streamed; parent tables must appear before their children in the plan.`);
                }
                scopeColumn = tableConfig.parentColumn;
                scopeValues = retainedIdsByTableName.get(tableConfig.parentTableName) || [];
            }
            /** @type {string[] | null} */
            const retainedIds = parentTableNames.has(tableConfig.tableName) ? [] : null;
            const quotedTable = db.quoteTable(tableConfig.tableName);
            const quotedScope = db.quoteColumn(scopeColumn);
            const selectList = selectColumns
                ? selectColumns.map((column) => `${quotedTable}.${db.quoteColumn(column)}`).join(", ")
                : `${quotedTable}.*`;
            /** @type {Record<string, unknown>[]} */
            let batch = [];
            for (const scopeChunk of chunks(uniqueStrings(scopeValues), this.queryChunkSize)) {
                const sql = `SELECT ${selectList} FROM ${quotedTable} WHERE ${quotedScope} IN (${this.quotedValuesSql(db, scopeChunk)})`;
                for await (const row of db.queryStream(sql)) {
                    batch.push(row);
                    if (retainedIds) {
                        retainedIds.push(String(row[this.idColumn]));
                    }
                    if (batch.length >= batchSize) {
                        yield { rows: batch, tableName: tableConfig.tableName };
                        batch = [];
                    }
                }
            }
            if (batch.length > 0) {
                yield { rows: batch, tableName: tableConfig.tableName };
            }
            retainedIdsByTableName.set(tableConfig.tableName, retainedIds || []);
        }
    }
    /**
     * Returns which of `ids` currently exist in `tableName` in `db`. `ids` is one already-bounded
     * batch, so it is probed with a single `IN (...)` lookup.
     * @param {{db: import("../drivers/base.js").default, ids: string[], tableName: string}} args - Database, ids to probe, and table.
     * @returns {Promise<Set<string>>} - The subset of `ids` present in the table.
     */
    async queryExistingIds({ db, ids, tableName }) {
        if (ids.length <= 0) {
            return new Set();
        }
        const quotedTable = db.quoteTable(tableName);
        const quotedId = db.quoteColumn(this.idColumn);
        const rows = await this.executeQuietQuery(db, `SELECT ${quotedTable}.${quotedId} FROM ${quotedTable} WHERE ${quotedId} IN (${this.quotedValuesSql(db, ids)})`);
        return new Set(rows.map((row) => String(row[this.idColumn])));
    }
    /**
     * Streams the source ids for `keyValue` and returns the first table found to be missing rows in
     * the target, with that batch's missing ids — stopping at the first shortfall instead of
     * enumerating every missing row. Callers verifying a tenant already holds every source row (for
     * example before deleting the source copies) treat an empty result as the go-ahead and any entry
     * as a hard stop; failing fast keeps memory bounded to a single batch even when the target is
     * far behind.
     * @param {string} keyValue - Tenant key selecting the source rows to check.
     * @param {{batchSize?: number}} [options] - Streaming batch size.
     * @returns {Promise<Map<string, string[]>>} - The first table missing rows and that batch's missing ids, or empty when the target holds everything.
     */
    async findMissingRowIds(keyValue, { batchSize = DEFAULT_STREAM_BATCH_SIZE } = {}) {
        /** @type {Map<string, string[]>} */
        const missingByTableName = new Map();
        for await (const { rows, tableName } of this.streamPlanSourceBatches(this.sourceDb, keyValue, { batchSize, selectColumns: [this.idColumn] })) {
            const ids = rows.map((row) => String(row[this.idColumn]));
            const existingIds = await this.queryExistingIds({ db: this.targetDb, ids, tableName });
            const missingIds = ids.filter((id) => !existingIds.has(id));
            if (missingIds.length > 0) {
                missingByTableName.set(tableName, missingIds);
                break;
            }
        }
        return missingByTableName;
    }
    /**
     * Streams the source rows for `keyValue` and copies into the target, batch by batch, only the
     * rows missing there. Because the full rows travel in the stream, each batch's missing rows are
     * inserted as it arrives — nothing is accumulated, and no second source query runs while the
     * source connection is held by the stream — so a table with large columns stays bounded to one
     * batch even when the target is empty. Intended for single-table plans (or plans whose per-table,
     * parent-first insert order is foreign-key safe).
     * @param {string} keyValue - Tenant key selecting the source rows to reconcile.
     * @param {{batchSize?: number}} [options] - Streaming batch size.
     * @returns {Promise<number>} - The number of rows copied into the target.
     */
    async copyMissingRows(keyValue, { batchSize = DEFAULT_STREAM_BATCH_SIZE } = {}) {
        let copiedCount = 0;
        for await (const { rows, tableName } of this.streamPlanSourceBatches(this.sourceDb, keyValue, { batchSize })) {
            const existingIds = await this.queryExistingIds({ db: this.targetDb, ids: rows.map((row) => String(row[this.idColumn])), tableName });
            const missingRows = rows.filter((row) => !existingIds.has(String(row[this.idColumn])));
            if (missingRows.length > 0) {
                await this.insertTargetRows(new Map([[tableName, missingRows]]));
                copiedCount += missingRows.length;
            }
        }
        return copiedCount;
    }
    /**
     * Selects `tableName` rows in `db` whose `columnName` is in `values`, chunked. `selectColumns`
     * bounds the projection and defaults to every column.
     * @param {{columnName: string, db: import("../drivers/base.js").default, selectColumns?: string[], tableName: string, values: string[]}} args - Table, column, projection, database, and values for the chunked lookup.
     * @returns {Promise<Record<string, unknown>[]>} - Rows matching the supplied column values.
     */
    async queryRowsByColumn({ columnName, db, selectColumns, tableName, values }) {
        const normalizedValues = uniqueStrings(values);
        if (normalizedValues.length <= 0) {
            return [];
        }
        const rows = [];
        const quotedTable = db.quoteTable(tableName);
        const quotedColumn = db.quoteColumn(columnName);
        const selectList = selectColumns
            ? selectColumns.map((column) => `${quotedTable}.${db.quoteColumn(column)}`).join(", ")
            : `${quotedTable}.*`;
        for (const valuesChunk of chunks(normalizedValues, this.queryChunkSize)) {
            const sql = `SELECT ${selectList} FROM ${quotedTable} WHERE ${quotedColumn} IN (${this.quotedValuesSql(db, valuesChunk)})`;
            rows.push(...await this.executeQuietQuery(db, sql));
        }
        return rows;
    }
    /**
     * Deletes the matching target rows for every plan table, children before parents, so the
     * reinsert that follows starts from a clean slate without violating foreign keys.
     * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
     * @returns {Promise<void>}
     */
    async deleteTargetRows(rowsByTableName) {
        await this.deleteRows({ db: this.targetDb, rowsByTableName });
    }
    /**
     * Deletes the supplied rows from `db`, children before parents.
     * @param {{db: import("../drivers/base.js").default, rowsByTableName: Map<string, Record<string, unknown>[]>}} args - Database and rows to delete.
     * @returns {Promise<void>}
     */
    async deleteRows({ db, rowsByTableName }) {
        for (const tableConfig of [...this.tablePlan].reverse()) {
            const rowIds = uniqueStrings((rowsByTableName.get(tableConfig.tableName) || []).map((row) => row[this.idColumn]));
            if (rowIds.length <= 0) {
                continue;
            }
            const quotedTable = db.quoteTable(tableConfig.tableName);
            const quotedIdColumn = db.quoteColumn(this.idColumn);
            for (const rowIdsChunk of chunks(rowIds, this.queryChunkSize)) {
                await this.executeQuietQuery(db, `DELETE FROM ${quotedTable} WHERE ${quotedIdColumn} IN (${this.quotedValuesSql(db, rowIdsChunk)})`);
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
        await this.insertRows({ db: this.targetDb, rowsByTableName });
    }
    /**
     * Inserts the supplied rows into `db`, parents before children.
     * @param {{db: import("../drivers/base.js").default, rowsByTableName: Map<string, Record<string, unknown>[]>}} args - Database and rows to insert.
     * @returns {Promise<void>}
     */
    async insertRows({ db, rowsByTableName }) {
        for (const tableConfig of this.tablePlan) {
            const rows = rowsByTableName.get(tableConfig.tableName) || [];
            if (rows.length <= 0) {
                continue;
            }
            const columns = Object.keys(rows[0]);
            const insertChunks = chunks(rows, this.insertChunkSize);
            this.reportProgress(`${tableConfig.tableName}: inserting ${rows.length} row(s) in ${insertChunks.length} chunk(s)`);
            for (const rowsChunk of insertChunks) {
                await this.insertRowsQuietly({
                    columns,
                    db,
                    rows: rowsChunk.map((row) => columns.map((column) => row[column])),
                    tableName: tableConfig.tableName
                });
            }
        }
    }
    /**
     * Returns whether any table in the loaded traversal contains rows.
     * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
     * @returns {boolean} - Whether any table contains rows.
     */
    rowsByTableNameHasRows(rowsByTableName) {
        for (const rows of rowsByTableName.values()) {
            if (rows.length > 0) {
                return true;
            }
        }
        return false;
    }
    /**
     * Clones source rows and applies the optional target-only transformation.
     * @param {{rowsByTableName: Map<string, Record<string, unknown>[]>, transformRow?: (args: {row: Record<string, unknown>, tableName: string}) => Record<string, unknown>}} args - Source rows and optional transformation.
     * @returns {Map<string, Record<string, unknown>[]>} - Cloned rows prepared for the target.
     */
    transformRows({ rowsByTableName, transformRow }) {
        const transformedRowsByTableName = new Map();
        for (const tableConfig of this.tablePlan) {
            const sourceRows = rowsByTableName.get(tableConfig.tableName) || [];
            const transformedRows = sourceRows.map((sourceRow) => {
                const transformedRow = transformRow
                    ? transformRow({ row: { ...sourceRow }, tableName: tableConfig.tableName })
                    : { ...sourceRow };
                if (String(transformedRow[this.idColumn]) !== String(sourceRow[this.idColumn])) {
                    throw new Error(`DataCopier move transform must preserve ${this.idColumn} for table ${tableConfig.tableName}.`);
                }
                return transformedRow;
            });
            transformedRowsByTableName.set(tableConfig.tableName, transformedRows);
        }
        return transformedRowsByTableName;
    }
    /**
     * Verifies that every supplied row id exists in `db`.
     * @param {{db: import("../drivers/base.js").default, rowsByTableName: Map<string, Record<string, unknown>[]>}} args - Database and rows to verify.
     * @returns {Promise<void>}
     */
    async assertRowsExist({ db, rowsByTableName }) {
        for (const tableConfig of this.tablePlan) {
            const expectedIds = uniqueStrings((rowsByTableName.get(tableConfig.tableName) || []).map((row) => row[this.idColumn]));
            const existingIds = await this.queryExistingIds({ db, ids: expectedIds, tableName: tableConfig.tableName });
            if (existingIds.size !== expectedIds.length) {
                throw new Error(`DataCopier move target verification failed for table ${tableConfig.tableName}.`);
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
        return values.map((value) => db.quote(value)).join(", ");
    }
    /**
     * Runs a query without per-query logging, used for the high-volume copy statements.
     * @param {import("../drivers/base.js").default} db - Database on which to execute the copy query.
     * @param {string} sql - Copy-related SQL statement to execute quietly.
     * @returns {Promise<Record<string, unknown>[]>} - Query result rows.
     */
    async executeQuietQuery(db, sql) {
        return await db.query(sql, { logQuery: false });
    }
    /**
     * Inserts column-aligned row tuples into a table without per-query logging.
     * @param {{columns: string[], db: import("../drivers/base.js").default, rows: Array<Array<unknown>>, tableName: string}} args - Destination table and column-aligned row values to insert.
     * @returns {Promise<void>}
     */
    async insertRowsQuietly({ columns, db, rows, tableName }) {
        await this.executeQuietQuery(db, db.insertSql({ columns, tableName, rows }));
    }
    /**
     * Forwards a progress message to the optional `onProgress` callback when one was given.
     * @param {string} message - Copy progress message to forward when reporting is enabled.
     * @returns {void}
     */
    reportProgress(message) {
        if (this.onProgress) {
            this.onProgress(message);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1jb3BpZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvdGVuYW50cy9kYXRhLWNvcGllci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFFdEQsTUFBTSx5QkFBeUIsR0FBRyxHQUFHLENBQUE7QUFDckMsTUFBTSx3QkFBd0IsR0FBRyxHQUFHLENBQUE7QUFDcEMsTUFBTSx5QkFBeUIsR0FBRyxJQUFJLENBQUE7QUFFdEM7Ozs7OztHQU1HO0FBQ0gsU0FBUyxNQUFNLENBQUMsTUFBTSxFQUFFLFNBQVM7SUFDL0IsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFBO0lBRXhCLEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxTQUFTLEVBQUUsQ0FBQztRQUM5RCxhQUFhLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFBO0lBQzVELENBQUM7SUFFRCxPQUFPLGFBQWEsQ0FBQTtBQUN0QixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsYUFBYSxDQUFDLE1BQU07SUFDM0IsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFBO0FBQ2xHLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sVUFBVTtJQUM3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LENBQUMsQ0FBQTtZQUV6RyxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUM1QyxNQUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxXQUFXLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQTtZQUNuRyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGVBQWUsQ0FBQyxFQUFFLEVBQUUsTUFBTTtRQUN4QixPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDMUQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsRUFBRSxHQUFHO1FBQzdCLE9BQU8sTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDO1FBQ3BELE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLEVBQUMsT0FBTyxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDNUUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxjQUFjLENBQUMsT0FBTztRQUNwQixJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNwQixJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzFCLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtQT09MX0NPTkZJR1VSQVRJT05fS0VZfSBmcm9tIFwiLi4vcG9vbC9iYXNlLmpzXCJcblxuY29uc3QgREVGQVVMVF9JTlNFUlRfQ0hVTktfU0laRSA9IDEwMFxuY29uc3QgREVGQVVMVF9RVUVSWV9DSFVOS19TSVpFID0gNTAwXG5jb25zdCBERUZBVUxUX1NUUkVBTV9CQVRDSF9TSVpFID0gMTAwMFxuXG4vKipcbiAqIFNwbGl0cyBhbiBhcnJheSBpbnRvIGNodW5rcyBvZiBhdCBtb3N0IGBjaHVua1NpemVgIGl0ZW1zLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7VFtdfSB2YWx1ZXMgLSBPcmRlcmVkIGl0ZW1zIHRvIHBhcnRpdGlvbi5cbiAqIEBwYXJhbSB7bnVtYmVyfSBjaHVua1NpemUgLSBNYXhpbXVtIGl0ZW1zIHBlciBjaHVuay5cbiAqIEByZXR1cm5zIHtUW11bXX0gLSBDb25zZWN1dGl2ZSBjaHVua3MgcHJlc2VydmluZyBpbnB1dCBvcmRlci5cbiAqL1xuZnVuY3Rpb24gY2h1bmtzKHZhbHVlcywgY2h1bmtTaXplKSB7XG4gIGNvbnN0IGNodW5rZWRWYWx1ZXMgPSBbXVxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCB2YWx1ZXMubGVuZ3RoOyBpbmRleCArPSBjaHVua1NpemUpIHtcbiAgICBjaHVua2VkVmFsdWVzLnB1c2godmFsdWVzLnNsaWNlKGluZGV4LCBpbmRleCArIGNodW5rU2l6ZSkpXG4gIH1cblxuICByZXR1cm4gY2h1bmtlZFZhbHVlc1xufVxuXG4vKipcbiAqIFN0cmluZ2lmaWVzIHZhbHVlcyBhbmQgcmV0dXJucyB0aGUgZGlzdGluY3QsIG5vbi1ibGFuayBvbmVzLCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gdmFsdWVzIC0gQ2FuZGlkYXRlIGRhdGFiYXNlIGlkZW50aWZpZXJzIHRvIHN0cmluZ2lmeSBhbmQgZGVkdXBsaWNhdGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IC0gRGlzdGluY3Qgbm9uLWJsYW5rIGlkZW50aWZpZXJzIGluIGZpcnN0LXNlZW4gb3JkZXIuXG4gKi9cbmZ1bmN0aW9uIHVuaXF1ZVN0cmluZ3ModmFsdWVzKSB7XG4gIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodmFsdWVzLm1hcCgodmFsdWUpID0+IFN0cmluZyh2YWx1ZSkpLmZpbHRlcigodmFsdWUpID0+IHZhbHVlLnRyaW0oKSkpKVxufVxuXG4vKipcbiAqIENvcGllcyBhIHNpbmdsZSB0ZW5hbnQncyByb3dzIGZyb20gYSBzb3VyY2UgZGF0YWJhc2UgaW50byBhIHRhcmdldCBkYXRhYmFzZSwgZm9sbG93aW5nIGFcbiAqIHRhYmxlIHBsYW4gdGhhdCBwYXJ0aXRpb25zIGVhY2ggdGFibGUgZWl0aGVyIGJ5IGEgZGlyZWN0IHRlbmFudCBrZXkgY29sdW1uIG9yIGJ5XG4gKiBwYXJlbnQtaWQgdHJhdmVyc2FsLiBUaGlzIGlzIHRoZSByb3ctbGV2ZWwgY291bnRlcnBhcnQgdG8gc2NoZW1hIGNsb25pbmc6IG11bHRpLXRlbmFudFxuICogYXBwcyB0aGF0IGtlZXAgZWFjaCB0ZW5hbnQncyBkYXRhIGluIGl0cyBvd24gZGF0YWJhc2UgdXNlIGl0IHRvIChyZSltYXRlcmlhbGlzZSB0aGVcbiAqIHRlbmFudCdzIHJvd3MgZnJvbSBhIGdsb2JhbC90ZW1wbGF0ZSBkYXRhYmFzZS5cbiAqXG4gKiBUaGUgY29weSBpcyBkZWxldGUtdGhlbi1yZWluc2VydCBhbmQgdGhlcmVmb3JlIGlkZW1wb3RlbnQsIGFuZCBpdCBtaXJyb3JzIHRoZSBzb3VyY2VcbiAqIHNuYXBzaG90OiB0aGUgcm93cyB0byBkZWxldGUgYXJlIHRoZSB0ZW5hbnQncyAqY3VycmVudCogcm93cyBpbiB0aGUgdGFyZ2V0IChzZWxlY3RlZCB3aXRoXG4gKiB0aGUgc2FtZSBwbGFuIHRyYXZlcnNhbCBydW4gYWdhaW5zdCB0aGUgdGFyZ2V0KSwgc28gYSByb3cgdGhhdCB3YXMgcmVtb3ZlZCBmcm9tIHRoZSBzb3VyY2VcbiAqIHNpbmNlIHRoZSBsYXN0IGNvcHkgaXMgZHJvcHBlZCBmcm9tIHRoZSB0YXJnZXQgdG9vIHJhdGhlciB0aGFuIGxpbmdlcmluZy4gVGhlIGRlbGV0ZXMgcnVuXG4gKiBjaGlsZHJlbiBmaXJzdCBhbmQgdGhlIHNvdXJjZSBpbnNlcnRzIHBhcmVudHMgZmlyc3QsIGFsbCBpbnNpZGUgb25lIHRhcmdldCB0cmFuc2FjdGlvbiB3aXRoXG4gKiBmb3JlaWduLWtleSBlbmZvcmNlbWVudCBkaXNhYmxlZCBzbyB0aGUgb3JkZXJpbmcgbmV2ZXIgdHJpcHMgYSBjb25zdHJhaW50LiBSZWFkcywgZGVsZXRlc1xuICogYW5kIGluc2VydHMgYXJlIGNodW5rZWQgdG8gYm91bmQgc3RhdGVtZW50IHNpemUuXG4gKlxuICogVGhlIGNvcGllciBpcyBwb2xpY3ktZnJlZTogdGhlIGNhbGxlciBzdXBwbGllcyB0aGUgcGxhbiwgdGhlIHNvdXJjZS90YXJnZXQgZGF0YWJhc2VzIGFuZFxuICogdGhlIHRlbmFudCBrZXksIGFuZCB7QGxpbmsgRGF0YUNvcGllciNjb3B5fSByZXR1cm5zIHRoZSBsb2FkZWQgcm93cyBrZXllZCBieSB0YWJsZSBuYW1lIHNvXG4gKiB0aGUgY2FsbGVyIGNhbiBwZXJmb3JtIGFueSBhcHAtc3BlY2lmaWMgcG9zdC1jb3B5IHdvcmsgKGZvciBleGFtcGxlIHJlZ2lzdGVyaW5nIHJlY29yZFxuICogbG9jYXRpb25zKSB3aXRob3V0IHRoYXQgcG9saWN5IGxlYWtpbmcgaW50byB0aGUgZnJhbWV3b3JrLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEYXRhQ29waWVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBjb3BpZXIgdGhhdCBtb3ZlcyB0ZW5hbnQtb3duZWQgcm93cyBmcm9tIGBzb3VyY2VEYmAgaW50byBgdGFyZ2V0RGJgLlxuICAgKiBAcGFyYW0ge3tcbiAgICogICBzb3VyY2VEYjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsXG4gICAqICAgdGFyZ2V0RGI6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LFxuICAgKiAgIHRhYmxlUGxhbjogaW1wb3J0KFwiLi90ZW5hbnQtdGFibGUtcGxhbi5qc1wiKS5UZW5hbnRUYWJsZVBsYW5FbnRyeVtdLFxuICAgKiAgIGlkQ29sdW1uPzogc3RyaW5nLFxuICAgKiAgIGluc2VydENodW5rU2l6ZT86IG51bWJlcixcbiAgICogICBxdWVyeUNodW5rU2l6ZT86IG51bWJlcixcbiAgICogICBvblByb2dyZXNzPzogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZFxuICAgKiB9fSBhcmdzIC0gU291cmNlLCB0YXJnZXQsIHRyYXZlcnNhbCBwbGFuLCBjaHVuayBsaW1pdHMsIGFuZCBwcm9ncmVzcyBoYW5kbGVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3NvdXJjZURiLCB0YXJnZXREYiwgdGFibGVQbGFuLCBpZENvbHVtbiA9IFwiaWRcIiwgaW5zZXJ0Q2h1bmtTaXplID0gREVGQVVMVF9JTlNFUlRfQ0hVTktfU0laRSwgcXVlcnlDaHVua1NpemUgPSBERUZBVUxUX1FVRVJZX0NIVU5LX1NJWkUsIG9uUHJvZ3Jlc3N9KSB7XG4gICAgdGhpcy5zb3VyY2VEYiA9IHNvdXJjZURiXG4gICAgdGhpcy50YXJnZXREYiA9IHRhcmdldERiXG4gICAgdGhpcy50YWJsZVBsYW4gPSB0YWJsZVBsYW5cbiAgICB0aGlzLmlkQ29sdW1uID0gaWRDb2x1bW5cbiAgICB0aGlzLmluc2VydENodW5rU2l6ZSA9IGluc2VydENodW5rU2l6ZVxuICAgIHRoaXMucXVlcnlDaHVua1NpemUgPSBxdWVyeUNodW5rU2l6ZVxuICAgIHRoaXMub25Qcm9ncmVzcyA9IG9uUHJvZ3Jlc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgZXZlcnkgcGxhbiB0YWJsZSdzIHJvd3MgZm9yIGBrZXlWYWx1ZWAgZnJvbSB0aGUgc291cmNlIGludG8gdGhlIHRhcmdldCBhbmRcbiAgICogcmV0dXJucyB0aGUgY29waWVkIHNvdXJjZSByb3dzIGtleWVkIGJ5IHRhYmxlIG5hbWUuIFRoZSB0YXJnZXQncyBjdXJyZW50IHRlbmFudCByb3dzXG4gICAqIGFyZSBkZWxldGVkIChjaGlsZHJlbiBmaXJzdCkgYW5kIHRoZSBzb3VyY2Ugcm93cyBpbnNlcnRlZCAocGFyZW50cyBmaXJzdCkgaW4gYSBzaW5nbGVcbiAgICogdGFyZ2V0IHRyYW5zYWN0aW9uIHdpdGggZm9yZWlnbiBrZXlzIGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5VmFsdWUgLSBUZW5hbnQga2V5IHNlbGVjdGluZyB0aGUgcm93cyB0byBjb3B5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPj59IC0gQ29waWVkIHNvdXJjZSByb3dzIGdyb3VwZWQgYnkgdGFibGUgbmFtZS5cbiAgICovXG4gIGFzeW5jIGNvcHkoa2V5VmFsdWUpIHtcbiAgICBjb25zdCBzb3VyY2VSb3dzQnlUYWJsZU5hbWUgPSBhd2FpdCB0aGlzLmxvYWRSb3dzKHRoaXMuc291cmNlRGIsIGtleVZhbHVlKVxuICAgIGNvbnN0IHRhcmdldFJvd3NCeVRhYmxlTmFtZSA9IGF3YWl0IHRoaXMubG9hZFJvd3ModGhpcy50YXJnZXREYiwga2V5VmFsdWUpXG5cbiAgICBhd2FpdCB0aGlzLnRhcmdldERiLndpdGhEaXNhYmxlZEZvcmVpZ25LZXlzKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMudGFyZ2V0RGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZVRhcmdldFJvd3ModGFyZ2V0Um93c0J5VGFibGVOYW1lKVxuICAgICAgICBhd2FpdCB0aGlzLmluc2VydFRhcmdldFJvd3Moc291cmNlUm93c0J5VGFibGVOYW1lKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHNvdXJjZVJvd3NCeVRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIGV2ZXJ5IHBsYW4gdGFibGUncyByb3dzIGZvciBga2V5VmFsdWVgIGZyb20gdGhlIHNvdXJjZSBpbnRvIHRoZSB0YXJnZXQuIFRoZSB0YXJnZXRcbiAgICogd3JpdGUgY29tbWl0cyBiZWZvcmUgdGhlIHNvdXJjZSBkZWxldGUgYmVnaW5zLCBzbyBhIHRhcmdldCBmYWlsdXJlIGxlYXZlcyB0aGUgc291cmNlXG4gICAqIHVudG91Y2hlZCBhbmQgYSBzb3VyY2UtZGVsZXRlIGZhaWx1cmUgY2FuIGJlIHJldHJpZWQgc2FmZWx5LiBXaGVuIHRoZSBzb3VyY2Ugbm8gbG9uZ2VyIGhhc1xuICAgKiBtYXRjaGluZyByb3dzLCB0aGUgbWV0aG9kIHJldHVybnMgdGhlIGVtcHR5IHRyYXZlcnNhbCB3aXRob3V0IGNoYW5naW5nIHRoZSB0YXJnZXQuXG4gICAqXG4gICAqIGB0cmFuc2Zvcm1Sb3dgIGNhbiBjaGFuZ2UgdGFyZ2V0LW9ubHkgdmFsdWVzIHN1Y2ggYXMgYSB0ZW5hbnQgb3duZXJzaGlwIGNvbHVtbi4gSXQgcmVjZWl2ZXNcbiAgICogYSBzaGFsbG93IGNsb25lIGFuZCBtdXN0IHByZXNlcnZlIHRoZSBjb25maWd1cmVkIGlkIGNvbHVtbiBzbyByZXRyaWVzIGFkZHJlc3MgdGhlIHNhbWUgcm93cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleVZhbHVlIC0gVGVuYW50IGtleSBzZWxlY3RpbmcgdGhlIHJvd3MgdG8gbW92ZS5cbiAgICogQHBhcmFtIHt7dHJhbnNmb3JtUm93PzogKGFyZ3M6IHtyb3c6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCB0YWJsZU5hbWU6IHN0cmluZ30pID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gW29wdGlvbnNdIC0gT3B0aW9uYWwgdGFyZ2V0LXJvdyB0cmFuc2Zvcm1hdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT4+fSAtIFJvd3Mgd3JpdHRlbiB0byB0aGUgdGFyZ2V0LCBncm91cGVkIGJ5IHRhYmxlIG5hbWUuXG4gICAqL1xuICBhc3luYyBtb3ZlKGtleVZhbHVlLCB7dHJhbnNmb3JtUm93fSA9IHt9KSB7XG4gICAgY29uc3Qgc291cmNlRGJXaXRoUG9vbEtleSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W1BPT0xfQ09ORklHVVJBVElPTl9LRVldPzogc3RyaW5nfX0gKi8gKHRoaXMuc291cmNlRGIpXG4gICAgY29uc3QgdGFyZ2V0RGJXaXRoUG9vbEtleSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7W1BPT0xfQ09ORklHVVJBVElPTl9LRVldPzogc3RyaW5nfX0gKi8gKHRoaXMudGFyZ2V0RGIpXG4gICAgY29uc3Qgc291cmNlUmV1c2VLZXkgPSBzb3VyY2VEYldpdGhQb29sS2V5W1BPT0xfQ09ORklHVVJBVElPTl9LRVldXG4gICAgY29uc3QgdGFyZ2V0UmV1c2VLZXkgPSB0YXJnZXREYldpdGhQb29sS2V5W1BPT0xfQ09ORklHVVJBVElPTl9LRVldXG4gICAgY29uc3Qgc2FtZVJlc29sdmVkRGF0YWJhc2UgPSB0aGlzLnNvdXJjZURiLmNvbmZpZ3VyYXRpb24gPT09IHRoaXMudGFyZ2V0RGIuY29uZmlndXJhdGlvblxuICAgICAgJiYgc291cmNlUmV1c2VLZXkgIT09IHVuZGVmaW5lZFxuICAgICAgJiYgc291cmNlUmV1c2VLZXkgPT09IHRhcmdldFJldXNlS2V5XG5cbiAgICBpZiAodGhpcy5zb3VyY2VEYiA9PT0gdGhpcy50YXJnZXREYiB8fCBzYW1lUmVzb2x2ZWREYXRhYmFzZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRGF0YUNvcGllciBtb3ZlIHJlcXVpcmVzIGRpZmZlcmVudCBwaHlzaWNhbCBkYXRhYmFzZXMuXCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlUm93c0J5VGFibGVOYW1lID0gYXdhaXQgdGhpcy5sb2FkUm93cyh0aGlzLnNvdXJjZURiLCBrZXlWYWx1ZSlcblxuICAgIGlmICghdGhpcy5yb3dzQnlUYWJsZU5hbWVIYXNSb3dzKHNvdXJjZVJvd3NCeVRhYmxlTmFtZSkpIHtcbiAgICAgIHJldHVybiBzb3VyY2VSb3dzQnlUYWJsZU5hbWVcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRSb3dzQnlUYWJsZU5hbWUgPSB0aGlzLnRyYW5zZm9ybVJvd3Moe3Jvd3NCeVRhYmxlTmFtZTogc291cmNlUm93c0J5VGFibGVOYW1lLCB0cmFuc2Zvcm1Sb3d9KVxuXG4gICAgYXdhaXQgdGhpcy50YXJnZXREYi53aXRoRGlzYWJsZWRGb3JlaWduS2V5cyhhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnRhcmdldERiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVSb3dzKHtkYjogdGhpcy50YXJnZXREYiwgcm93c0J5VGFibGVOYW1lOiBzb3VyY2VSb3dzQnlUYWJsZU5hbWV9KVxuICAgICAgICBhd2FpdCB0aGlzLmluc2VydFJvd3Moe2RiOiB0aGlzLnRhcmdldERiLCByb3dzQnlUYWJsZU5hbWU6IHRhcmdldFJvd3NCeVRhYmxlTmFtZX0pXG4gICAgICAgIGF3YWl0IHRoaXMuYXNzZXJ0Um93c0V4aXN0KHtkYjogdGhpcy50YXJnZXREYiwgcm93c0J5VGFibGVOYW1lOiB0YXJnZXRSb3dzQnlUYWJsZU5hbWV9KVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5zb3VyY2VEYi53aXRoRGlzYWJsZWRGb3JlaWduS2V5cyhhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnNvdXJjZURiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVSb3dzKHtkYjogdGhpcy5zb3VyY2VEYiwgcm93c0J5VGFibGVOYW1lOiBzb3VyY2VSb3dzQnlUYWJsZU5hbWV9KVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRhcmdldFJvd3NCeVRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgb25lIHRlbmFudCdzIHJvd3MgZnJvbSB0aGUgdGFyZ2V0IGRhdGFiYXNlLCBjaGlsZHJlbiBiZWZvcmUgcGFyZW50cywgd2l0aFxuICAgKiBmb3JlaWduIGtleXMgZGlzYWJsZWQgaW5zaWRlIGEgc2luZ2xlIHRyYW5zYWN0aW9uLiBUaGlzIGlzIGBjb3B5YCB3aXRob3V0IHRoZSByZWluc2VydDpcbiAgICogdGhlIHNhbWUgcGxhbiB0cmF2ZXJzYWwgc2VsZWN0cyB0aGUgdGVuYW50J3MgY3VycmVudCB0YXJnZXQgcm93cyBhbmQgYGRlbGV0ZVRhcmdldFJvd3NgXG4gICAqIHJlbW92ZXMgdGhlbSBjaGlsZHJlbi1maXJzdCBzbyB0aGUgb3JkZXJpbmcgbmV2ZXIgdHJpcHMgYSBmb3JlaWduIGtleS4gTXVsdGktdGVuYW50IGFwcHNcbiAgICogdXNlIGl0IHRvIHB1cmdlIGEgdGVuYW50IOKAlCBmb3IgZXhhbXBsZSBjbGVhcmluZyB0aGUgdGVuYW50J3MgbWFzdGVyIGNvcHkgaW4gdGhlXG4gICAqIGdsb2JhbC9kZWZhdWx0IGRhdGFiYXNlIG9uIHRlYXJkb3duLCBzbyBmb3JlaWduIGtleXMgc3RvcCByZWZlcmVuY2luZyB0aGUgdGVuYW50J3NcbiAgICogYWJvdXQtdG8tYmUtcmVtb3ZlZCByb290IHJvdy5cbiAgICpcbiAgICogUmV0dXJucyB0aGUgZGVsZXRlZCByb3dzIGtleWVkIGJ5IHRhYmxlIG5hbWUgc28gdGhlIGNhbGxlciBjYW4gcGVyZm9ybSBhbnkgYXBwLXNwZWNpZmljXG4gICAqIHBvc3QtZGVsZXRlIHdvcmsgKHJlY29yZC1sb2NhdGlvbiBjbGVhbnVwLCBhdWRpdGluZykgd2l0aG91dCB0aGF0IHBvbGljeSBsZWFraW5nIGludG8gdGhlXG4gICAqIGZyYW1ld29yay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleVZhbHVlIC0gVGVuYW50IGtleSB3aG9zZSByb3dzIHNob3VsZCBiZSByZW1vdmVkIGZyb20gdGhlIHRhcmdldC5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT4+fSAtIFRoZSBkZWxldGVkIHJvd3MgYnkgdGFibGUgbmFtZS5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVRlbmFudFJvd3Moa2V5VmFsdWUpIHtcbiAgICBjb25zdCByb3dzQnlUYWJsZU5hbWUgPSBhd2FpdCB0aGlzLmxvYWRSb3dzKHRoaXMudGFyZ2V0RGIsIGtleVZhbHVlKVxuXG4gICAgYXdhaXQgdGhpcy50YXJnZXREYi53aXRoRGlzYWJsZWRGb3JlaWduS2V5cyhhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnRhcmdldERiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVUYXJnZXRSb3dzKHJvd3NCeVRhYmxlTmFtZSlcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIHJldHVybiByb3dzQnlUYWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgcm93cyBmb3IgYGtleVZhbHVlYCBmb3IgZXZlcnkgdGFibGUgaW4gdGhlIHBsYW4gZnJvbSBgZGJgLCByZXNvbHZpbmdcbiAgICogcGFyZW50LXNjb3BlZCB0YWJsZXMgZnJvbSB0aGUgaWRzIGFscmVhZHkgc2VsZWN0ZWQgZm9yIHRoZWlyIHBhcmVudCB0YWJsZS4gVXNlZCBmb3JcbiAgICogYm90aCB0aGUgc291cmNlIHJvd3MgdG8gY29weSBhbmQgdGhlIHRhcmdldCdzIGN1cnJlbnQgdGVuYW50IHJvd3MgdG8gZGVsZXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFNvdXJjZSBvciB0YXJnZXQgZGF0YWJhc2UgdG8gdHJhdmVyc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlWYWx1ZSAtIFRlbmFudCBrZXkgc2VsZWN0aW5nIHRoZSByb290IHBsYW4gcm93cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT4+fSAtIExvYWRlZCByb3dzIGdyb3VwZWQgYnkgdGFibGUgbmFtZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSb3dzKGRiLCBrZXlWYWx1ZSkge1xuICAgIHJldHVybiAoYXdhaXQgdGhpcy50cmF2ZXJzZVBsYW4oZGIsIGtleVZhbHVlKSkucm93c0J5VGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgb25seSB0aGUgaWRzIGZvciBga2V5VmFsdWVgIGZvciBldmVyeSB0YWJsZSBpbiB0aGUgcGxhbiBmcm9tIGBkYmAsIHVzaW5nIHRoZSBzYW1lXG4gICAqIHBhcmVudC9jaGlsZCB0cmF2ZXJzYWwgYXMge0BsaW5rIERhdGFDb3BpZXIjbG9hZFJvd3N9IGJ1dCBzZWxlY3RpbmcganVzdCB0aGUgaWQgY29sdW1uLlxuICAgKiBDYWxsZXJzIHRoYXQgb25seSBuZWVkIHRvIGNvbXBhcmUgcm93IG1lbWJlcnNoaXAg4oCUIGZvciBleGFtcGxlIHZlcmlmeWluZyBhIHRlbmFudCBhbHJlYWR5XG4gICAqIGhvbGRzIGV2ZXJ5IGRlZmF1bHQgcm93IGJlZm9yZSBhIGNsZWFudXAgZGVsZXRlIOKAlCBzaG91bGQgdXNlIHRoaXMgaW5zdGVhZCBvZiBsb2FkUm93cyBzb1xuICAgKiB0aGV5IG5ldmVyIG1hdGVyaWFsaXNlIGZ1bGwgcm93czsgZm9yIGxhcmdlIHRlbmFudHMgdGhhdCBpcyB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgZmV3XG4gICAqIGtpbG9ieXRlcyBvZiBpZHMgYW5kIGdpZ2FieXRlcyBvZiByb3cgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBTb3VyY2Ugb3IgdGFyZ2V0IGRhdGFiYXNlIHRvIHRyYXZlcnNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5VmFsdWUgLSBUZW5hbnQga2V5IHNlbGVjdGluZyB0aGUgcm9vdCBwbGFuIHJvd3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIHN0cmluZ1tdPj59IC0gTG9hZGVkIGlkcyBncm91cGVkIGJ5IHRhYmxlIG5hbWUuXG4gICAqL1xuICBhc3luYyBsb2FkUm93SWRzKGRiLCBrZXlWYWx1ZSkge1xuICAgIHJldHVybiAoYXdhaXQgdGhpcy50cmF2ZXJzZVBsYW4oZGIsIGtleVZhbHVlLCBbdGhpcy5pZENvbHVtbl0pKS5pZHNCeVRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYXZlcnNlcyB0aGUgdGFibGUgcGxhbiBmb3IgYGtleVZhbHVlYCwgcXVlcnlpbmcgZWFjaCB0YWJsZSBieSBpdHMgdGVuYW50IGtleSBjb2x1bW4gb3JcbiAgICogKGZvciBjaGlsZCB0YWJsZXMpIGJ5IHRoZSBpZHMgYWxyZWFkeSBzZWxlY3RlZCBmb3IgaXRzIHBhcmVudCwgYW5kIHJldHVybnMgYm90aCB0aGUgaWRzXG4gICAqIGFuZCB0aGUgbG9hZGVkIHJvd3MgZ3JvdXBlZCBieSB0YWJsZSBuYW1lLiBgc2VsZWN0Q29sdW1uc2AgYm91bmRzIHRoZSBjb2x1bW5zIGVhY2ggcXVlcnlcbiAgICogc2VsZWN0czsgcGFzcyBgW2lkQ29sdW1uXWAgZm9yIGFuIGlkLW9ubHkgdHJhdmVyc2FsLCBvciBvbWl0IGl0IHRvIGxvYWQgZnVsbCByb3dzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFNvdXJjZSBvciB0YXJnZXQgZGF0YWJhc2UgdG8gdHJhdmVyc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlWYWx1ZSAtIFRlbmFudCBrZXkgc2VsZWN0aW5nIHRoZSByb290IHBsYW4gcm93cy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW3NlbGVjdENvbHVtbnNdIC0gQ29sdW1ucyB0byBzZWxlY3Q7IGRlZmF1bHRzIHRvIGV2ZXJ5IGNvbHVtbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2lkc0J5VGFibGVOYW1lOiBNYXA8c3RyaW5nLCBzdHJpbmdbXT4sIHJvd3NCeVRhYmxlTmFtZTogTWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT59Pn0gLSBJZHMgYW5kIHJvd3MgZ3JvdXBlZCBieSB0YWJsZSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgdHJhdmVyc2VQbGFuKGRiLCBrZXlWYWx1ZSwgc2VsZWN0Q29sdW1ucykge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICAgIGNvbnN0IGlkc0J5VGFibGVOYW1lID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPn0gKi9cbiAgICBjb25zdCByb3dzQnlUYWJsZU5hbWUgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgdGFibGVDb25maWcgb2YgdGhpcy50YWJsZVBsYW4pIHtcbiAgICAgIGxldCByb3dzXG5cbiAgICAgIGlmICh0YWJsZUNvbmZpZy5rZXlDb2x1bW4pIHtcbiAgICAgICAgcm93cyA9IGF3YWl0IHRoaXMucXVlcnlSb3dzQnlDb2x1bW4oe1xuICAgICAgICAgIGNvbHVtbk5hbWU6IHRhYmxlQ29uZmlnLmtleUNvbHVtbixcbiAgICAgICAgICBkYixcbiAgICAgICAgICBzZWxlY3RDb2x1bW5zLFxuICAgICAgICAgIHRhYmxlTmFtZTogdGFibGVDb25maWcudGFibGVOYW1lLFxuICAgICAgICAgIHZhbHVlczogW2tleVZhbHVlXVxuICAgICAgICB9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCF0YWJsZUNvbmZpZy5wYXJlbnRDb2x1bW4gfHwgIXRhYmxlQ29uZmlnLnBhcmVudFRhYmxlTmFtZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQga2V5Q29sdW1uIG9yIHBhcmVudFRhYmxlTmFtZStwYXJlbnRDb2x1bW4gZm9yIHRhYmxlICR7dGFibGVDb25maWcudGFibGVOYW1lfSBpbiB0aGUgdGVuYW50IHRhYmxlIHBsYW4uYClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaWRzQnlUYWJsZU5hbWUuaGFzKHRhYmxlQ29uZmlnLnBhcmVudFRhYmxlTmFtZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCB0YWJsZSBwbGFuIGVudHJ5ICR7dGFibGVDb25maWcudGFibGVOYW1lfSByZWZlcmVuY2VzIHBhcmVudCB0YWJsZSAke3RhYmxlQ29uZmlnLnBhcmVudFRhYmxlTmFtZX0sIHdoaWNoIGhhcyBub3QgYmVlbiBsb2FkZWQ7IHBhcmVudCB0YWJsZXMgbXVzdCBhcHBlYXIgYmVmb3JlIHRoZWlyIGNoaWxkcmVuIGluIHRoZSBwbGFuLmApXG4gICAgICAgIH1cblxuICAgICAgICByb3dzID0gYXdhaXQgdGhpcy5xdWVyeVJvd3NCeUNvbHVtbih7XG4gICAgICAgICAgY29sdW1uTmFtZTogdGFibGVDb25maWcucGFyZW50Q29sdW1uLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHNlbGVjdENvbHVtbnMsXG4gICAgICAgICAgdGFibGVOYW1lOiB0YWJsZUNvbmZpZy50YWJsZU5hbWUsXG4gICAgICAgICAgdmFsdWVzOiBpZHNCeVRhYmxlTmFtZS5nZXQodGFibGVDb25maWcucGFyZW50VGFibGVOYW1lKSB8fCBbXVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAocm93cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMucmVwb3J0UHJvZ3Jlc3MoYCR7dGFibGVDb25maWcudGFibGVOYW1lfTogbG9hZGVkICR7cm93cy5sZW5ndGh9IHJvdyhzKWApXG4gICAgICB9XG5cbiAgICAgIGlkc0J5VGFibGVOYW1lLnNldCh0YWJsZUNvbmZpZy50YWJsZU5hbWUsIHVuaXF1ZVN0cmluZ3Mocm93cy5tYXAoKHJvdykgPT4gcm93W3RoaXMuaWRDb2x1bW5dKSkpXG4gICAgICByb3dzQnlUYWJsZU5hbWUuc2V0KHRhYmxlQ29uZmlnLnRhYmxlTmFtZSwgcm93cylcbiAgICB9XG5cbiAgICByZXR1cm4ge2lkc0J5VGFibGVOYW1lLCByb3dzQnlUYWJsZU5hbWV9XG4gIH1cblxuICAvKipcbiAgICogVGhlIHBsYW4gdGFibGVzIHJlZmVyZW5jZWQgYXMgYSBwYXJlbnQgYnkgc29tZSBjaGlsZCBlbnRyeS4gVGhlaXIgaWRzIG11c3QgYmUgcmV0YWluZWRcbiAgICogd2hpbGUgc3RyZWFtaW5nIHNvIHRoZWlyIGNoaWxkcmVuIGNhbiBiZSBzY29wZWQ7IGxlYWYgdGFibGVzIOKAlCB0eXBpY2FsbHkgdGhlIGhpZ2gtdm9sdW1lXG4gICAqIG9uZXMg4oCUIGFyZSBuZXZlciBpbiB0aGlzIHNldCBhbmQgc28gYXJlIG5ldmVyIGFjY3VtdWxhdGVkIGluIG1lbW9yeS5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIFRhYmxlIG5hbWVzIHRoYXQgYXJlIGEgcGFyZW50IG9mIGFub3RoZXIgcGxhbiBlbnRyeS5cbiAgICovXG4gIHBhcmVudFRhYmxlTmFtZXMoKSB7XG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBuYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCB0YWJsZUNvbmZpZyBvZiB0aGlzLnRhYmxlUGxhbikge1xuICAgICAgaWYgKHRhYmxlQ29uZmlnLnBhcmVudFRhYmxlTmFtZSkge1xuICAgICAgICBuYW1lcy5hZGQodGFibGVDb25maWcucGFyZW50VGFibGVOYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBuYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFN0cmVhbXMgZXZlcnkgcGxhbiB0YWJsZSdzIHNvdXJjZSByb3dzIHNjb3BlZCB0byBga2V5VmFsdWVgIGluIGJvdW5kZWQgYGJhdGNoU2l6ZWAgYmF0Y2hlcyxcbiAgICogZm9sbG93aW5nIHBhcmVudC9jaGlsZCBjaGFpbmluZy4gRWFjaCB0YWJsZSBpcyByZWFkIHRocm91Z2ggYSByZWFsXG4gICAqIHtAbGluayBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCNxdWVyeVN0cmVhbX0gY3Vyc29yLCBzbyBhIGxhcmdlIHRhYmxlIGlzIG5ldmVyXG4gICAqIGJ1ZmZlcmVkOyBvbmx5IHRoZSBpZHMgb2YgdGFibGVzIHRoYXQgYXJlIHRoZW1zZWx2ZXMgYSBwYXJlbnQgYXJlIHJldGFpbmVkICh0byBzY29wZSB0aGVpclxuICAgKiBjaGlsZHJlbikuIGBzZWxlY3RDb2x1bW5zYCBib3VuZHMgZWFjaCByb3cncyBwcm9qZWN0aW9uIOKAlCBwYXNzIGBbaWRDb2x1bW5dYCBmb3IgYSBsaWdodFxuICAgKiBpZC1vbmx5IHNjYW4sIG9yIG9taXQgaXQgdG8gc3RyZWFtIGZ1bGwgcm93cyDigJQgYW5kIG11c3QgaW5jbHVkZSB0aGUgaWQgY29sdW1uIGZvciBhbnkgdGFibGVcbiAgICogdGhhdCBoYXMgY2hpbGRyZW4uIE1lbW9yeSBzdGF5cyBib3VuZGVkIHRvIG9uZSBiYXRjaCBwbHVzIHRoZSByZXRhaW5lZCBwYXJlbnQtdGFibGUgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFNvdXJjZSBkYXRhYmFzZSB0byBzdHJlYW0uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlWYWx1ZSAtIFRlbmFudCBrZXkgc2VsZWN0aW5nIHRoZSByb290IHBsYW4gcm93cy5cbiAgICogQHBhcmFtIHt7YmF0Y2hTaXplOiBudW1iZXIsIHNlbGVjdENvbHVtbnM/OiBzdHJpbmdbXX19IG9wdGlvbnMgLSBCYXRjaCBzaXplIGFuZCBvcHRpb25hbCBwcm9qZWN0aW9uLlxuICAgKiBAeWllbGRzIHt7cm93czogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSwgdGFibGVOYW1lOiBzdHJpbmd9fSAtIFN1Y2Nlc3NpdmUgcm93IGJhdGNoZXMgcGVyIHRhYmxlLlxuICAgKi9cbiAgYXN5bmMgKnN0cmVhbVBsYW5Tb3VyY2VCYXRjaGVzKGRiLCBrZXlWYWx1ZSwge2JhdGNoU2l6ZSwgc2VsZWN0Q29sdW1uc30pIHtcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgICBjb25zdCByZXRhaW5lZElkc0J5VGFibGVOYW1lID0gbmV3IE1hcCgpXG4gICAgY29uc3QgcGFyZW50VGFibGVOYW1lcyA9IHRoaXMucGFyZW50VGFibGVOYW1lcygpXG5cbiAgICBmb3IgKGNvbnN0IHRhYmxlQ29uZmlnIG9mIHRoaXMudGFibGVQbGFuKSB7XG4gICAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICAgIGxldCBzY29wZUNvbHVtblxuICAgICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICAgIGxldCBzY29wZVZhbHVlc1xuXG4gICAgICBpZiAodGFibGVDb25maWcua2V5Q29sdW1uKSB7XG4gICAgICAgIHNjb3BlQ29sdW1uID0gdGFibGVDb25maWcua2V5Q29sdW1uXG4gICAgICAgIHNjb3BlVmFsdWVzID0gW2tleVZhbHVlXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCF0YWJsZUNvbmZpZy5wYXJlbnRDb2x1bW4gfHwgIXRhYmxlQ29uZmlnLnBhcmVudFRhYmxlTmFtZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQga2V5Q29sdW1uIG9yIHBhcmVudFRhYmxlTmFtZStwYXJlbnRDb2x1bW4gZm9yIHRhYmxlICR7dGFibGVDb25maWcudGFibGVOYW1lfSBpbiB0aGUgdGVuYW50IHRhYmxlIHBsYW4uYClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghcmV0YWluZWRJZHNCeVRhYmxlTmFtZS5oYXModGFibGVDb25maWcucGFyZW50VGFibGVOYW1lKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IHRhYmxlIHBsYW4gZW50cnkgJHt0YWJsZUNvbmZpZy50YWJsZU5hbWV9IHJlZmVyZW5jZXMgcGFyZW50IHRhYmxlICR7dGFibGVDb25maWcucGFyZW50VGFibGVOYW1lfSwgd2hpY2ggaGFzIG5vdCBiZWVuIHN0cmVhbWVkOyBwYXJlbnQgdGFibGVzIG11c3QgYXBwZWFyIGJlZm9yZSB0aGVpciBjaGlsZHJlbiBpbiB0aGUgcGxhbi5gKVxuICAgICAgICB9XG5cbiAgICAgICAgc2NvcGVDb2x1bW4gPSB0YWJsZUNvbmZpZy5wYXJlbnRDb2x1bW5cbiAgICAgICAgc2NvcGVWYWx1ZXMgPSByZXRhaW5lZElkc0J5VGFibGVOYW1lLmdldCh0YWJsZUNvbmZpZy5wYXJlbnRUYWJsZU5hbWUpIHx8IFtdXG4gICAgICB9XG5cbiAgICAgIC8qKiBAdHlwZSB7c3RyaW5nW10gfCBudWxsfSAqL1xuICAgICAgY29uc3QgcmV0YWluZWRJZHMgPSBwYXJlbnRUYWJsZU5hbWVzLmhhcyh0YWJsZUNvbmZpZy50YWJsZU5hbWUpID8gW10gOiBudWxsXG4gICAgICBjb25zdCBxdW90ZWRUYWJsZSA9IGRiLnF1b3RlVGFibGUodGFibGVDb25maWcudGFibGVOYW1lKVxuICAgICAgY29uc3QgcXVvdGVkU2NvcGUgPSBkYi5xdW90ZUNvbHVtbihzY29wZUNvbHVtbilcbiAgICAgIGNvbnN0IHNlbGVjdExpc3QgPSBzZWxlY3RDb2x1bW5zXG4gICAgICAgID8gc2VsZWN0Q29sdW1ucy5tYXAoKGNvbHVtbikgPT4gYCR7cXVvdGVkVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oY29sdW1uKX1gKS5qb2luKFwiLCBcIilcbiAgICAgICAgOiBgJHtxdW90ZWRUYWJsZX0uKmBcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj5bXX0gKi9cbiAgICAgIGxldCBiYXRjaCA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgc2NvcGVDaHVuayBvZiBjaHVua3ModW5pcXVlU3RyaW5ncyhzY29wZVZhbHVlcyksIHRoaXMucXVlcnlDaHVua1NpemUpKSB7XG4gICAgICAgIGNvbnN0IHNxbCA9IGBTRUxFQ1QgJHtzZWxlY3RMaXN0fSBGUk9NICR7cXVvdGVkVGFibGV9IFdIRVJFICR7cXVvdGVkU2NvcGV9IElOICgke3RoaXMucXVvdGVkVmFsdWVzU3FsKGRiLCBzY29wZUNodW5rKX0pYFxuXG4gICAgICAgIGZvciBhd2FpdCAoY29uc3Qgcm93IG9mIGRiLnF1ZXJ5U3RyZWFtKHNxbCkpIHtcbiAgICAgICAgICBiYXRjaC5wdXNoKHJvdylcblxuICAgICAgICAgIGlmIChyZXRhaW5lZElkcykge1xuICAgICAgICAgICAgcmV0YWluZWRJZHMucHVzaChTdHJpbmcocm93W3RoaXMuaWRDb2x1bW5dKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoYmF0Y2gubGVuZ3RoID49IGJhdGNoU2l6ZSkge1xuICAgICAgICAgICAgeWllbGQge3Jvd3M6IGJhdGNoLCB0YWJsZU5hbWU6IHRhYmxlQ29uZmlnLnRhYmxlTmFtZX1cbiAgICAgICAgICAgIGJhdGNoID0gW11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGJhdGNoLmxlbmd0aCA+IDApIHtcbiAgICAgICAgeWllbGQge3Jvd3M6IGJhdGNoLCB0YWJsZU5hbWU6IHRhYmxlQ29uZmlnLnRhYmxlTmFtZX1cbiAgICAgIH1cblxuICAgICAgcmV0YWluZWRJZHNCeVRhYmxlTmFtZS5zZXQodGFibGVDb25maWcudGFibGVOYW1lLCByZXRhaW5lZElkcyB8fCBbXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGljaCBvZiBgaWRzYCBjdXJyZW50bHkgZXhpc3QgaW4gYHRhYmxlTmFtZWAgaW4gYGRiYC4gYGlkc2AgaXMgb25lIGFscmVhZHktYm91bmRlZFxuICAgKiBiYXRjaCwgc28gaXQgaXMgcHJvYmVkIHdpdGggYSBzaW5nbGUgYElOICguLi4pYCBsb29rdXAuXG4gICAqIEBwYXJhbSB7e2RiOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgaWRzOiBzdHJpbmdbXSwgdGFibGVOYW1lOiBzdHJpbmd9fSBhcmdzIC0gRGF0YWJhc2UsIGlkcyB0byBwcm9iZSwgYW5kIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTZXQ8c3RyaW5nPj59IC0gVGhlIHN1YnNldCBvZiBgaWRzYCBwcmVzZW50IGluIHRoZSB0YWJsZS5cbiAgICovXG4gIGFzeW5jIHF1ZXJ5RXhpc3RpbmdJZHMoe2RiLCBpZHMsIHRhYmxlTmFtZX0pIHtcbiAgICBpZiAoaWRzLmxlbmd0aCA8PSAwKSB7XG4gICAgICByZXR1cm4gbmV3IFNldCgpXG4gICAgfVxuXG4gICAgY29uc3QgcXVvdGVkVGFibGUgPSBkYi5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgICBjb25zdCBxdW90ZWRJZCA9IGRiLnF1b3RlQ29sdW1uKHRoaXMuaWRDb2x1bW4pXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZXhlY3V0ZVF1aWV0UXVlcnkoZGIsIGBTRUxFQ1QgJHtxdW90ZWRUYWJsZX0uJHtxdW90ZWRJZH0gRlJPTSAke3F1b3RlZFRhYmxlfSBXSEVSRSAke3F1b3RlZElkfSBJTiAoJHt0aGlzLnF1b3RlZFZhbHVlc1NxbChkYiwgaWRzKX0pYClcblxuICAgIHJldHVybiBuZXcgU2V0KHJvd3MubWFwKChyb3cpID0+IFN0cmluZyhyb3dbdGhpcy5pZENvbHVtbl0pKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdHJlYW1zIHRoZSBzb3VyY2UgaWRzIGZvciBga2V5VmFsdWVgIGFuZCByZXR1cm5zIHRoZSBmaXJzdCB0YWJsZSBmb3VuZCB0byBiZSBtaXNzaW5nIHJvd3MgaW5cbiAgICogdGhlIHRhcmdldCwgd2l0aCB0aGF0IGJhdGNoJ3MgbWlzc2luZyBpZHMg4oCUIHN0b3BwaW5nIGF0IHRoZSBmaXJzdCBzaG9ydGZhbGwgaW5zdGVhZCBvZlxuICAgKiBlbnVtZXJhdGluZyBldmVyeSBtaXNzaW5nIHJvdy4gQ2FsbGVycyB2ZXJpZnlpbmcgYSB0ZW5hbnQgYWxyZWFkeSBob2xkcyBldmVyeSBzb3VyY2Ugcm93IChmb3JcbiAgICogZXhhbXBsZSBiZWZvcmUgZGVsZXRpbmcgdGhlIHNvdXJjZSBjb3BpZXMpIHRyZWF0IGFuIGVtcHR5IHJlc3VsdCBhcyB0aGUgZ28tYWhlYWQgYW5kIGFueSBlbnRyeVxuICAgKiBhcyBhIGhhcmQgc3RvcDsgZmFpbGluZyBmYXN0IGtlZXBzIG1lbW9yeSBib3VuZGVkIHRvIGEgc2luZ2xlIGJhdGNoIGV2ZW4gd2hlbiB0aGUgdGFyZ2V0IGlzXG4gICAqIGZhciBiZWhpbmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlWYWx1ZSAtIFRlbmFudCBrZXkgc2VsZWN0aW5nIHRoZSBzb3VyY2Ugcm93cyB0byBjaGVjay5cbiAgICogQHBhcmFtIHt7YmF0Y2hTaXplPzogbnVtYmVyfX0gW29wdGlvbnNdIC0gU3RyZWFtaW5nIGJhdGNoIHNpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIHN0cmluZ1tdPj59IC0gVGhlIGZpcnN0IHRhYmxlIG1pc3Npbmcgcm93cyBhbmQgdGhhdCBiYXRjaCdzIG1pc3NpbmcgaWRzLCBvciBlbXB0eSB3aGVuIHRoZSB0YXJnZXQgaG9sZHMgZXZlcnl0aGluZy5cbiAgICovXG4gIGFzeW5jIGZpbmRNaXNzaW5nUm93SWRzKGtleVZhbHVlLCB7YmF0Y2hTaXplID0gREVGQVVMVF9TVFJFQU1fQkFUQ0hfU0laRX0gPSB7fSkge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICAgIGNvbnN0IG1pc3NpbmdCeVRhYmxlTmFtZSA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIGF3YWl0IChjb25zdCB7cm93cywgdGFibGVOYW1lfSBvZiB0aGlzLnN0cmVhbVBsYW5Tb3VyY2VCYXRjaGVzKHRoaXMuc291cmNlRGIsIGtleVZhbHVlLCB7YmF0Y2hTaXplLCBzZWxlY3RDb2x1bW5zOiBbdGhpcy5pZENvbHVtbl19KSkge1xuICAgICAgY29uc3QgaWRzID0gcm93cy5tYXAoKHJvdykgPT4gU3RyaW5nKHJvd1t0aGlzLmlkQ29sdW1uXSkpXG4gICAgICBjb25zdCBleGlzdGluZ0lkcyA9IGF3YWl0IHRoaXMucXVlcnlFeGlzdGluZ0lkcyh7ZGI6IHRoaXMudGFyZ2V0RGIsIGlkcywgdGFibGVOYW1lfSlcbiAgICAgIGNvbnN0IG1pc3NpbmdJZHMgPSBpZHMuZmlsdGVyKChpZCkgPT4gIWV4aXN0aW5nSWRzLmhhcyhpZCkpXG5cbiAgICAgIGlmIChtaXNzaW5nSWRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbWlzc2luZ0J5VGFibGVOYW1lLnNldCh0YWJsZU5hbWUsIG1pc3NpbmdJZHMpXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG1pc3NpbmdCeVRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0cmVhbXMgdGhlIHNvdXJjZSByb3dzIGZvciBga2V5VmFsdWVgIGFuZCBjb3BpZXMgaW50byB0aGUgdGFyZ2V0LCBiYXRjaCBieSBiYXRjaCwgb25seSB0aGVcbiAgICogcm93cyBtaXNzaW5nIHRoZXJlLiBCZWNhdXNlIHRoZSBmdWxsIHJvd3MgdHJhdmVsIGluIHRoZSBzdHJlYW0sIGVhY2ggYmF0Y2gncyBtaXNzaW5nIHJvd3MgYXJlXG4gICAqIGluc2VydGVkIGFzIGl0IGFycml2ZXMg4oCUIG5vdGhpbmcgaXMgYWNjdW11bGF0ZWQsIGFuZCBubyBzZWNvbmQgc291cmNlIHF1ZXJ5IHJ1bnMgd2hpbGUgdGhlXG4gICAqIHNvdXJjZSBjb25uZWN0aW9uIGlzIGhlbGQgYnkgdGhlIHN0cmVhbSDigJQgc28gYSB0YWJsZSB3aXRoIGxhcmdlIGNvbHVtbnMgc3RheXMgYm91bmRlZCB0byBvbmVcbiAgICogYmF0Y2ggZXZlbiB3aGVuIHRoZSB0YXJnZXQgaXMgZW1wdHkuIEludGVuZGVkIGZvciBzaW5nbGUtdGFibGUgcGxhbnMgKG9yIHBsYW5zIHdob3NlIHBlci10YWJsZSxcbiAgICogcGFyZW50LWZpcnN0IGluc2VydCBvcmRlciBpcyBmb3JlaWduLWtleSBzYWZlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleVZhbHVlIC0gVGVuYW50IGtleSBzZWxlY3RpbmcgdGhlIHNvdXJjZSByb3dzIHRvIHJlY29uY2lsZS5cbiAgICogQHBhcmFtIHt7YmF0Y2hTaXplPzogbnVtYmVyfX0gW29wdGlvbnNdIC0gU3RyZWFtaW5nIGJhdGNoIHNpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gVGhlIG51bWJlciBvZiByb3dzIGNvcGllZCBpbnRvIHRoZSB0YXJnZXQuXG4gICAqL1xuICBhc3luYyBjb3B5TWlzc2luZ1Jvd3Moa2V5VmFsdWUsIHtiYXRjaFNpemUgPSBERUZBVUxUX1NUUkVBTV9CQVRDSF9TSVpFfSA9IHt9KSB7XG4gICAgbGV0IGNvcGllZENvdW50ID0gMFxuXG4gICAgZm9yIGF3YWl0IChjb25zdCB7cm93cywgdGFibGVOYW1lfSBvZiB0aGlzLnN0cmVhbVBsYW5Tb3VyY2VCYXRjaGVzKHRoaXMuc291cmNlRGIsIGtleVZhbHVlLCB7YmF0Y2hTaXplfSkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nSWRzID0gYXdhaXQgdGhpcy5xdWVyeUV4aXN0aW5nSWRzKHtkYjogdGhpcy50YXJnZXREYiwgaWRzOiByb3dzLm1hcCgocm93KSA9PiBTdHJpbmcocm93W3RoaXMuaWRDb2x1bW5dKSksIHRhYmxlTmFtZX0pXG4gICAgICBjb25zdCBtaXNzaW5nUm93cyA9IHJvd3MuZmlsdGVyKChyb3cpID0+ICFleGlzdGluZ0lkcy5oYXMoU3RyaW5nKHJvd1t0aGlzLmlkQ29sdW1uXSkpKVxuXG4gICAgICBpZiAobWlzc2luZ1Jvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBhd2FpdCB0aGlzLmluc2VydFRhcmdldFJvd3MobmV3IE1hcChbW3RhYmxlTmFtZSwgbWlzc2luZ1Jvd3NdXSkpXG4gICAgICAgIGNvcGllZENvdW50ICs9IG1pc3NpbmdSb3dzLmxlbmd0aFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb3BpZWRDb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdHMgYHRhYmxlTmFtZWAgcm93cyBpbiBgZGJgIHdob3NlIGBjb2x1bW5OYW1lYCBpcyBpbiBgdmFsdWVzYCwgY2h1bmtlZC4gYHNlbGVjdENvbHVtbnNgXG4gICAqIGJvdW5kcyB0aGUgcHJvamVjdGlvbiBhbmQgZGVmYXVsdHMgdG8gZXZlcnkgY29sdW1uLlxuICAgKiBAcGFyYW0ge3tjb2x1bW5OYW1lOiBzdHJpbmcsIGRiOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgc2VsZWN0Q29sdW1ucz86IHN0cmluZ1tdLCB0YWJsZU5hbWU6IHN0cmluZywgdmFsdWVzOiBzdHJpbmdbXX19IGFyZ3MgLSBUYWJsZSwgY29sdW1uLCBwcm9qZWN0aW9uLCBkYXRhYmFzZSwgYW5kIHZhbHVlcyBmb3IgdGhlIGNodW5rZWQgbG9va3VwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPn0gLSBSb3dzIG1hdGNoaW5nIHRoZSBzdXBwbGllZCBjb2x1bW4gdmFsdWVzLlxuICAgKi9cbiAgYXN5bmMgcXVlcnlSb3dzQnlDb2x1bW4oe2NvbHVtbk5hbWUsIGRiLCBzZWxlY3RDb2x1bW5zLCB0YWJsZU5hbWUsIHZhbHVlc30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkVmFsdWVzID0gdW5pcXVlU3RyaW5ncyh2YWx1ZXMpXG5cbiAgICBpZiAobm9ybWFsaXplZFZhbHVlcy5sZW5ndGggPD0gMCkge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IFtdXG4gICAgY29uc3QgcXVvdGVkVGFibGUgPSBkYi5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgICBjb25zdCBxdW90ZWRDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKVxuICAgIGNvbnN0IHNlbGVjdExpc3QgPSBzZWxlY3RDb2x1bW5zXG4gICAgICA/IHNlbGVjdENvbHVtbnMubWFwKChjb2x1bW4pID0+IGAke3F1b3RlZFRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKGNvbHVtbil9YCkuam9pbihcIiwgXCIpXG4gICAgICA6IGAke3F1b3RlZFRhYmxlfS4qYFxuXG4gICAgZm9yIChjb25zdCB2YWx1ZXNDaHVuayBvZiBjaHVua3Mobm9ybWFsaXplZFZhbHVlcywgdGhpcy5xdWVyeUNodW5rU2l6ZSkpIHtcbiAgICAgIGNvbnN0IHNxbCA9IGBTRUxFQ1QgJHtzZWxlY3RMaXN0fSBGUk9NICR7cXVvdGVkVGFibGV9IFdIRVJFICR7cXVvdGVkQ29sdW1ufSBJTiAoJHt0aGlzLnF1b3RlZFZhbHVlc1NxbChkYiwgdmFsdWVzQ2h1bmspfSlgXG5cbiAgICAgIHJvd3MucHVzaCguLi5hd2FpdCB0aGlzLmV4ZWN1dGVRdWlldFF1ZXJ5KGRiLCBzcWwpKVxuICAgIH1cblxuICAgIHJldHVybiByb3dzXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0aGUgbWF0Y2hpbmcgdGFyZ2V0IHJvd3MgZm9yIGV2ZXJ5IHBsYW4gdGFibGUsIGNoaWxkcmVuIGJlZm9yZSBwYXJlbnRzLCBzbyB0aGVcbiAgICogcmVpbnNlcnQgdGhhdCBmb2xsb3dzIHN0YXJ0cyBmcm9tIGEgY2xlYW4gc2xhdGUgd2l0aG91dCB2aW9sYXRpbmcgZm9yZWlnbiBrZXlzLlxuICAgKiBAcGFyYW0ge01hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10+fSByb3dzQnlUYWJsZU5hbWUgLSBSb3dzIGdyb3VwZWQgYnkgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBkZWxldGVUYXJnZXRSb3dzKHJvd3NCeVRhYmxlTmFtZSkge1xuICAgIGF3YWl0IHRoaXMuZGVsZXRlUm93cyh7ZGI6IHRoaXMudGFyZ2V0RGIsIHJvd3NCeVRhYmxlTmFtZX0pXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0aGUgc3VwcGxpZWQgcm93cyBmcm9tIGBkYmAsIGNoaWxkcmVuIGJlZm9yZSBwYXJlbnRzLlxuICAgKiBAcGFyYW0ge3tkYjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHJvd3NCeVRhYmxlTmFtZTogTWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT59fSBhcmdzIC0gRGF0YWJhc2UgYW5kIHJvd3MgdG8gZGVsZXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVJvd3Moe2RiLCByb3dzQnlUYWJsZU5hbWV9KSB7XG4gICAgZm9yIChjb25zdCB0YWJsZUNvbmZpZyBvZiBbLi4udGhpcy50YWJsZVBsYW5dLnJldmVyc2UoKSkge1xuICAgICAgY29uc3Qgcm93SWRzID0gdW5pcXVlU3RyaW5ncygocm93c0J5VGFibGVOYW1lLmdldCh0YWJsZUNvbmZpZy50YWJsZU5hbWUpIHx8IFtdKS5tYXAoKHJvdykgPT4gcm93W3RoaXMuaWRDb2x1bW5dKSlcblxuICAgICAgaWYgKHJvd0lkcy5sZW5ndGggPD0gMCkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBxdW90ZWRUYWJsZSA9IGRiLnF1b3RlVGFibGUodGFibGVDb25maWcudGFibGVOYW1lKVxuICAgICAgY29uc3QgcXVvdGVkSWRDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbih0aGlzLmlkQ29sdW1uKVxuXG4gICAgICBmb3IgKGNvbnN0IHJvd0lkc0NodW5rIG9mIGNodW5rcyhyb3dJZHMsIHRoaXMucXVlcnlDaHVua1NpemUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZVF1aWV0UXVlcnkoXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgYERFTEVURSBGUk9NICR7cXVvdGVkVGFibGV9IFdIRVJFICR7cXVvdGVkSWRDb2x1bW59IElOICgke3RoaXMucXVvdGVkVmFsdWVzU3FsKGRiLCByb3dJZHNDaHVuayl9KWBcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIHRoZSBsb2FkZWQgc291cmNlIHJvd3MgaW50byB0aGUgdGFyZ2V0IGZvciBldmVyeSBwbGFuIHRhYmxlLCBwYXJlbnRzIGJlZm9yZVxuICAgKiBjaGlsZHJlbiwgY2h1bmtlZCB0byBib3VuZCBzdGF0ZW1lbnQgc2l6ZS5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPn0gcm93c0J5VGFibGVOYW1lIC0gUm93cyBncm91cGVkIGJ5IHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0VGFyZ2V0Um93cyhyb3dzQnlUYWJsZU5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLmluc2VydFJvd3Moe2RiOiB0aGlzLnRhcmdldERiLCByb3dzQnlUYWJsZU5hbWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgdGhlIHN1cHBsaWVkIHJvd3MgaW50byBgZGJgLCBwYXJlbnRzIGJlZm9yZSBjaGlsZHJlbi5cbiAgICogQHBhcmFtIHt7ZGI6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCByb3dzQnlUYWJsZU5hbWU6IE1hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10+fX0gYXJncyAtIERhdGFiYXNlIGFuZCByb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBpbnNlcnRSb3dzKHtkYiwgcm93c0J5VGFibGVOYW1lfSkge1xuICAgIGZvciAoY29uc3QgdGFibGVDb25maWcgb2YgdGhpcy50YWJsZVBsYW4pIHtcbiAgICAgIGNvbnN0IHJvd3MgPSByb3dzQnlUYWJsZU5hbWUuZ2V0KHRhYmxlQ29uZmlnLnRhYmxlTmFtZSkgfHwgW11cblxuICAgICAgaWYgKHJvd3MubGVuZ3RoIDw9IDApIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29sdW1ucyA9IE9iamVjdC5rZXlzKHJvd3NbMF0pXG4gICAgICBjb25zdCBpbnNlcnRDaHVua3MgPSBjaHVua3Mocm93cywgdGhpcy5pbnNlcnRDaHVua1NpemUpXG5cbiAgICAgIHRoaXMucmVwb3J0UHJvZ3Jlc3MoYCR7dGFibGVDb25maWcudGFibGVOYW1lfTogaW5zZXJ0aW5nICR7cm93cy5sZW5ndGh9IHJvdyhzKSBpbiAke2luc2VydENodW5rcy5sZW5ndGh9IGNodW5rKHMpYClcblxuICAgICAgZm9yIChjb25zdCByb3dzQ2h1bmsgb2YgaW5zZXJ0Q2h1bmtzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5zZXJ0Um93c1F1aWV0bHkoe1xuICAgICAgICAgIGNvbHVtbnMsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgcm93czogcm93c0NodW5rLm1hcCgocm93KSA9PiBjb2x1bW5zLm1hcCgoY29sdW1uKSA9PiByb3dbY29sdW1uXSkpLFxuICAgICAgICAgIHRhYmxlTmFtZTogdGFibGVDb25maWcudGFibGVOYW1lXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBhbnkgdGFibGUgaW4gdGhlIGxvYWRlZCB0cmF2ZXJzYWwgY29udGFpbnMgcm93cy5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPn0gcm93c0J5VGFibGVOYW1lIC0gUm93cyBncm91cGVkIGJ5IHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRhYmxlIGNvbnRhaW5zIHJvd3MuXG4gICAqL1xuICByb3dzQnlUYWJsZU5hbWVIYXNSb3dzKHJvd3NCeVRhYmxlTmFtZSkge1xuICAgIGZvciAoY29uc3Qgcm93cyBvZiByb3dzQnlUYWJsZU5hbWUudmFsdWVzKCkpIHtcbiAgICAgIGlmIChyb3dzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9uZXMgc291cmNlIHJvd3MgYW5kIGFwcGxpZXMgdGhlIG9wdGlvbmFsIHRhcmdldC1vbmx5IHRyYW5zZm9ybWF0aW9uLlxuICAgKiBAcGFyYW0ge3tyb3dzQnlUYWJsZU5hbWU6IE1hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10+LCB0cmFuc2Zvcm1Sb3c/OiAoYXJnczoge3JvdzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHRhYmxlTmFtZTogc3RyaW5nfSkgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj59fSBhcmdzIC0gU291cmNlIHJvd3MgYW5kIG9wdGlvbmFsIHRyYW5zZm9ybWF0aW9uLlxuICAgKiBAcmV0dXJucyB7TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXT59IC0gQ2xvbmVkIHJvd3MgcHJlcGFyZWQgZm9yIHRoZSB0YXJnZXQuXG4gICAqL1xuICB0cmFuc2Zvcm1Sb3dzKHtyb3dzQnlUYWJsZU5hbWUsIHRyYW5zZm9ybVJvd30pIHtcbiAgICBjb25zdCB0cmFuc2Zvcm1lZFJvd3NCeVRhYmxlTmFtZSA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCB0YWJsZUNvbmZpZyBvZiB0aGlzLnRhYmxlUGxhbikge1xuICAgICAgY29uc3Qgc291cmNlUm93cyA9IHJvd3NCeVRhYmxlTmFtZS5nZXQodGFibGVDb25maWcudGFibGVOYW1lKSB8fCBbXVxuICAgICAgY29uc3QgdHJhbnNmb3JtZWRSb3dzID0gc291cmNlUm93cy5tYXAoKHNvdXJjZVJvdykgPT4ge1xuICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZFJvdyA9IHRyYW5zZm9ybVJvd1xuICAgICAgICAgID8gdHJhbnNmb3JtUm93KHtyb3c6IHsuLi5zb3VyY2VSb3d9LCB0YWJsZU5hbWU6IHRhYmxlQ29uZmlnLnRhYmxlTmFtZX0pXG4gICAgICAgICAgOiB7Li4uc291cmNlUm93fVxuXG4gICAgICAgIGlmIChTdHJpbmcodHJhbnNmb3JtZWRSb3dbdGhpcy5pZENvbHVtbl0pICE9PSBTdHJpbmcoc291cmNlUm93W3RoaXMuaWRDb2x1bW5dKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRGF0YUNvcGllciBtb3ZlIHRyYW5zZm9ybSBtdXN0IHByZXNlcnZlICR7dGhpcy5pZENvbHVtbn0gZm9yIHRhYmxlICR7dGFibGVDb25maWcudGFibGVOYW1lfS5gKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVkUm93XG4gICAgICB9KVxuXG4gICAgICB0cmFuc2Zvcm1lZFJvd3NCeVRhYmxlTmFtZS5zZXQodGFibGVDb25maWcudGFibGVOYW1lLCB0cmFuc2Zvcm1lZFJvd3MpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVkUm93c0J5VGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgdGhhdCBldmVyeSBzdXBwbGllZCByb3cgaWQgZXhpc3RzIGluIGBkYmAuXG4gICAqIEBwYXJhbSB7e2RiOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgcm93c0J5VGFibGVOYW1lOiBNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdPn19IGFyZ3MgLSBEYXRhYmFzZSBhbmQgcm93cyB0byB2ZXJpZnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXNzZXJ0Um93c0V4aXN0KHtkYiwgcm93c0J5VGFibGVOYW1lfSkge1xuICAgIGZvciAoY29uc3QgdGFibGVDb25maWcgb2YgdGhpcy50YWJsZVBsYW4pIHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkSWRzID0gdW5pcXVlU3RyaW5ncygocm93c0J5VGFibGVOYW1lLmdldCh0YWJsZUNvbmZpZy50YWJsZU5hbWUpIHx8IFtdKS5tYXAoKHJvdykgPT4gcm93W3RoaXMuaWRDb2x1bW5dKSlcbiAgICAgIGNvbnN0IGV4aXN0aW5nSWRzID0gYXdhaXQgdGhpcy5xdWVyeUV4aXN0aW5nSWRzKHtkYiwgaWRzOiBleHBlY3RlZElkcywgdGFibGVOYW1lOiB0YWJsZUNvbmZpZy50YWJsZU5hbWV9KVxuXG4gICAgICBpZiAoZXhpc3RpbmdJZHMuc2l6ZSAhPT0gZXhwZWN0ZWRJZHMubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRGF0YUNvcGllciBtb3ZlIHRhcmdldCB2ZXJpZmljYXRpb24gZmFpbGVkIGZvciB0YWJsZSAke3RhYmxlQ29uZmlnLnRhYmxlTmFtZX0uYClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUXVvdGVzIGFuZCBjb21tYS1qb2lucyB2YWx1ZXMgZm9yIGFuIFNRTCBgSU4gKC4uLilgIGxpc3QgYWdhaW5zdCB0aGUgZ2l2ZW4gZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgcXVvdGluZyBydWxlcyBmb3JtYXQgdGhlIHZhbHVlcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdmFsdWVzIC0gVmFsdWVzIHRvIHF1b3RlIGZvciB0aGUgYElOYCBsaXN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1b3RlZCBTUUwgdmFsdWUgbGlzdC5cbiAgICovXG4gIHF1b3RlZFZhbHVlc1NxbChkYiwgdmFsdWVzKSB7XG4gICAgcmV0dXJuIHZhbHVlcy5tYXAoKHZhbHVlKSA9PiBkYi5xdW90ZSh2YWx1ZSkpLmpvaW4oXCIsIFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBxdWVyeSB3aXRob3V0IHBlci1xdWVyeSBsb2dnaW5nLCB1c2VkIGZvciB0aGUgaGlnaC12b2x1bWUgY29weSBzdGF0ZW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIG9uIHdoaWNoIHRvIGV4ZWN1dGUgdGhlIGNvcHkgcXVlcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBDb3B5LXJlbGF0ZWQgU1FMIHN0YXRlbWVudCB0byBleGVjdXRlIHF1aWV0bHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+W10+fSAtIFF1ZXJ5IHJlc3VsdCByb3dzLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZVF1aWV0UXVlcnkoZGIsIHNxbCkge1xuICAgIHJldHVybiBhd2FpdCBkYi5xdWVyeShzcWwsIHtsb2dRdWVyeTogZmFsc2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgY29sdW1uLWFsaWduZWQgcm93IHR1cGxlcyBpbnRvIGEgdGFibGUgd2l0aG91dCBwZXItcXVlcnkgbG9nZ2luZy5cbiAgICogQHBhcmFtIHt7Y29sdW1uczogc3RyaW5nW10sIGRiOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgcm93czogQXJyYXk8QXJyYXk8dW5rbm93bj4+LCB0YWJsZU5hbWU6IHN0cmluZ319IGFyZ3MgLSBEZXN0aW5hdGlvbiB0YWJsZSBhbmQgY29sdW1uLWFsaWduZWQgcm93IHZhbHVlcyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0Um93c1F1aWV0bHkoe2NvbHVtbnMsIGRiLCByb3dzLCB0YWJsZU5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5leGVjdXRlUXVpZXRRdWVyeShkYiwgZGIuaW5zZXJ0U3FsKHtjb2x1bW5zLCB0YWJsZU5hbWUsIHJvd3N9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkcyBhIHByb2dyZXNzIG1lc3NhZ2UgdG8gdGhlIG9wdGlvbmFsIGBvblByb2dyZXNzYCBjYWxsYmFjayB3aGVuIG9uZSB3YXMgZ2l2ZW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gQ29weSBwcm9ncmVzcyBtZXNzYWdlIHRvIGZvcndhcmQgd2hlbiByZXBvcnRpbmcgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXBvcnRQcm9ncmVzcyhtZXNzYWdlKSB7XG4gICAgaWYgKHRoaXMub25Qcm9ncmVzcykge1xuICAgICAgdGhpcy5vblByb2dyZXNzKG1lc3NhZ2UpXG4gICAgfVxuICB9XG59XG4iXX0=