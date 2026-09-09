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
    sourceDb: import("../drivers/base.js").default;
    targetDb: import("../drivers/base.js").default;
    tablePlan: import("./tenant-table-plan.js").TenantTablePlanEntry[];
    idColumn: string;
    insertChunkSize: number;
    queryChunkSize: number;
    onProgress: ((message: string) => void) | undefined;
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
    constructor({ sourceDb, targetDb, tablePlan, idColumn, insertChunkSize, queryChunkSize, onProgress }: {
        sourceDb: import("../drivers/base.js").default;
        targetDb: import("../drivers/base.js").default;
        tablePlan: import("./tenant-table-plan.js").TenantTablePlanEntry[];
        idColumn?: string;
        insertChunkSize?: number;
        queryChunkSize?: number;
        onProgress?: (message: string) => void;
    });
    /**
     * Copies every plan table's rows for `keyValue` from the source into the target and
     * returns the copied source rows keyed by table name. The target's current tenant rows
     * are deleted (children first) and the source rows inserted (parents first) in a single
     * target transaction with foreign keys disabled.
     * @param {string} keyValue - Tenant key selecting the rows to copy.
     * @returns {Promise<Map<string, Record<string, unknown>[]>>} - Copied source rows grouped by table name.
     */
    copy(keyValue: string): Promise<Map<string, Record<string, unknown>[]>>;
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
    move(keyValue: string, { transformRow }?: {
        transformRow?: (args: {
            row: Record<string, unknown>;
            tableName: string;
        }) => Record<string, unknown>;
    }): Promise<Map<string, Record<string, unknown>[]>>;
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
    deleteTenantRows(keyValue: string): Promise<Map<string, Record<string, unknown>[]>>;
    /**
     * Loads the rows for `keyValue` for every table in the plan from `db`, resolving
     * parent-scoped tables from the ids already selected for their parent table. Used for
     * both the source rows to copy and the target's current tenant rows to delete.
     * @param {import("../drivers/base.js").default} db - Source or target database to traverse.
     * @param {string} keyValue - Tenant key selecting the root plan rows.
     * @returns {Promise<Map<string, Record<string, unknown>[]>>} - Loaded rows grouped by table name.
     */
    loadRows(db: import("../drivers/base.js").default, keyValue: string): Promise<Map<string, Record<string, unknown>[]>>;
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
    loadRowIds(db: import("../drivers/base.js").default, keyValue: string): Promise<Map<string, string[]>>;
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
    traversePlan(db: import("../drivers/base.js").default, keyValue: string, selectColumns?: string[]): Promise<{
        idsByTableName: Map<string, string[]>;
        rowsByTableName: Map<string, Record<string, unknown>[]>;
    }>;
    /**
     * The plan tables referenced as a parent by some child entry. Their ids must be retained
     * while streaming so their children can be scoped; leaf tables — typically the high-volume
     * ones — are never in this set and so are never accumulated in memory.
     * @returns {Set<string>} - Table names that are a parent of another plan entry.
     */
    parentTableNames(): Set<string>;
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
    streamPlanSourceBatches(db: import("../drivers/base.js").default, keyValue: string, { batchSize, selectColumns }: {
        batchSize: number;
        selectColumns?: string[];
    }): AsyncGenerator<{
        rows: Record<string, unknown>[];
        tableName: string;
    }, void, unknown>;
    /**
     * Returns which of `ids` currently exist in `tableName` in `db`. `ids` is one already-bounded
     * batch, so it is probed with a single `IN (...)` lookup.
     * @param {{db: import("../drivers/base.js").default, ids: string[], tableName: string}} args - Database, ids to probe, and table.
     * @returns {Promise<Set<string>>} - The subset of `ids` present in the table.
     */
    queryExistingIds({ db, ids, tableName }: {
        db: import("../drivers/base.js").default;
        ids: string[];
        tableName: string;
    }): Promise<Set<string>>;
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
    findMissingRowIds(keyValue: string, { batchSize }?: {
        batchSize?: number;
    }): Promise<Map<string, string[]>>;
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
    copyMissingRows(keyValue: string, { batchSize }?: {
        batchSize?: number;
    }): Promise<number>;
    /**
     * Selects `tableName` rows in `db` whose `columnName` is in `values`, chunked. `selectColumns`
     * bounds the projection and defaults to every column.
     * @param {{columnName: string, db: import("../drivers/base.js").default, selectColumns?: string[], tableName: string, values: string[]}} args - Table, column, projection, database, and values for the chunked lookup.
     * @returns {Promise<Record<string, unknown>[]>} - Rows matching the supplied column values.
     */
    queryRowsByColumn({ columnName, db, selectColumns, tableName, values }: {
        columnName: string;
        db: import("../drivers/base.js").default;
        selectColumns?: string[];
        tableName: string;
        values: string[];
    }): Promise<Record<string, unknown>[]>;
    /**
     * Deletes the matching target rows for every plan table, children before parents, so the
     * reinsert that follows starts from a clean slate without violating foreign keys.
     * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
     * @returns {Promise<void>}
     */
    deleteTargetRows(rowsByTableName: Map<string, Record<string, unknown>[]>): Promise<void>;
    /**
     * Deletes the supplied rows from `db`, children before parents.
     * @param {{db: import("../drivers/base.js").default, rowsByTableName: Map<string, Record<string, unknown>[]>}} args - Database and rows to delete.
     * @returns {Promise<void>}
     */
    deleteRows({ db, rowsByTableName }: {
        db: import("../drivers/base.js").default;
        rowsByTableName: Map<string, Record<string, unknown>[]>;
    }): Promise<void>;
    /**
     * Inserts the loaded source rows into the target for every plan table, parents before
     * children, chunked to bound statement size.
     * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
     * @returns {Promise<void>}
     */
    insertTargetRows(rowsByTableName: Map<string, Record<string, unknown>[]>): Promise<void>;
    /**
     * Inserts the supplied rows into `db`, parents before children.
     * @param {{db: import("../drivers/base.js").default, rowsByTableName: Map<string, Record<string, unknown>[]>}} args - Database and rows to insert.
     * @returns {Promise<void>}
     */
    insertRows({ db, rowsByTableName }: {
        db: import("../drivers/base.js").default;
        rowsByTableName: Map<string, Record<string, unknown>[]>;
    }): Promise<void>;
    /**
     * Returns whether any table in the loaded traversal contains rows.
     * @param {Map<string, Record<string, unknown>[]>} rowsByTableName - Rows grouped by table name.
     * @returns {boolean} - Whether any table contains rows.
     */
    rowsByTableNameHasRows(rowsByTableName: Map<string, Record<string, unknown>[]>): boolean;
    /**
     * Clones source rows and applies the optional target-only transformation.
     * @param {{rowsByTableName: Map<string, Record<string, unknown>[]>, transformRow?: (args: {row: Record<string, unknown>, tableName: string}) => Record<string, unknown>}} args - Source rows and optional transformation.
     * @returns {Map<string, Record<string, unknown>[]>} - Cloned rows prepared for the target.
     */
    transformRows({ rowsByTableName, transformRow }: {
        rowsByTableName: Map<string, Record<string, unknown>[]>;
        transformRow?: (args: {
            row: Record<string, unknown>;
            tableName: string;
        }) => Record<string, unknown>;
    }): Map<string, Record<string, unknown>[]>;
    /**
     * Verifies that every supplied row id exists in `db`.
     * @param {{db: import("../drivers/base.js").default, rowsByTableName: Map<string, Record<string, unknown>[]>}} args - Database and rows to verify.
     * @returns {Promise<void>}
     */
    assertRowsExist({ db, rowsByTableName }: {
        db: import("../drivers/base.js").default;
        rowsByTableName: Map<string, Record<string, unknown>[]>;
    }): Promise<void>;
    /**
     * Quotes and comma-joins values for an SQL `IN (...)` list against the given database.
     * @param {import("../drivers/base.js").default} db - Database whose quoting rules format the values.
     * @param {string[]} values - Values to quote for the `IN` list.
     * @returns {string} - Quoted SQL value list.
     */
    quotedValuesSql(db: import("../drivers/base.js").default, values: string[]): string;
    /**
     * Runs a query without per-query logging, used for the high-volume copy statements.
     * @param {import("../drivers/base.js").default} db - Database on which to execute the copy query.
     * @param {string} sql - Copy-related SQL statement to execute quietly.
     * @returns {Promise<Record<string, unknown>[]>} - Query result rows.
     */
    executeQuietQuery(db: import("../drivers/base.js").default, sql: string): Promise<Record<string, unknown>[]>;
    /**
     * Inserts column-aligned row tuples into a table without per-query logging.
     * @param {{columns: string[], db: import("../drivers/base.js").default, rows: Array<Array<unknown>>, tableName: string}} args - Destination table and column-aligned row values to insert.
     * @returns {Promise<void>}
     */
    insertRowsQuietly({ columns, db, rows, tableName }: {
        columns: string[];
        db: import("../drivers/base.js").default;
        rows: Array<Array<unknown>>;
        tableName: string;
    }): Promise<void>;
    /**
     * Forwards a progress message to the optional `onProgress` callback when one was given.
     * @param {string} message - Copy progress message to forward when reporting is enabled.
     * @returns {void}
     */
    reportProgress(message: string): void;
}
//# sourceMappingURL=data-copier.d.ts.map