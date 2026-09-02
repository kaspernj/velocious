import Configuration from "../configuration.js";
/**
 * Allocates monotonically increasing server sync sequences from an
 * AUTO_INCREMENT id table: every allocation inserts a row and returns the
 * driver's last-insert id, so sequences stay unique and increasing across
 * processes sharing the same database.
 *
 * Backed by an auto-created `velocious_server_sequences` table on the
 * configured database, with a process-local memory counter fallback when no
 * database is configured (mirroring the sync scope store). Apps with an
 * existing sequence table (for example a bare `id`-only AUTO_INCREMENT table)
 * point `tableName` at it and pass `insertData: {}` to insert empty rows.
 */
export default class ServerSequenceAllocator {
    configuration: Configuration | undefined;
    databaseIdentifier: string;
    insertData: Record<string, any> | undefined;
    tableName: string;
    _memorySequence: number;
    _isReady: boolean;
    /** @type {Promise<void> | null} */
    _readyPromise: Promise<void> | null;
    /**
     * Creates a server sequence allocator.
     * @param {object} [args] - Options.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the database. Defaults to the current configuration, resolved lazily per allocation.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.insertData] - Row payload inserted per allocation. Defaults to `{created_at: new Date()}` matching the auto-created table; pass `{}` for bare id-only tables.
     * @param {string} [args.tableName] - Sequence table name.
     */
    constructor({ configuration, databaseIdentifier, insertData, tableName }?: {
        configuration?: import("../configuration.js").default;
        databaseIdentifier?: string;
        insertData?: Record<string, ReturnType<typeof JSON.parse>>;
        tableName?: string;
    });
    /**
     * Allocates the next monotonically increasing sequence.
     *
     * Allocations serialize through a module-level queue per database+table so
     * parallel `next()` calls - including calls from other allocator instances
     * sharing the same table and connection - cannot interleave their insert
     * and last-insert-id reads and hand out duplicate sequences.
     * @param {{connection?: import("../database/drivers/base.js").default}} [options] - Explicit record-owned connection.
     * @returns {Promise<number>} Next sequence value.
     */
    next({ connection }?: {
        connection?: import("../database/drivers/base.js").default;
    }): Promise<number>;
    /**
     * Allocates for a record while preserving allocator routing and operation ownership.
     * @param {import("../database/record/index.js").default} record - Record receiving the sequence.
     * @returns {Promise<number>} Next sequence value.
     */
    _nextForRecord(record: import("../database/record/index.js").default): Promise<number>;
    /**
     * Ensures the backing table exists.
     * @param {import("../database/drivers/base.js").default} [connection] - Explicit record-owned connection.
     * @returns {Promise<void>} Resolves when ready.
     */
    ensureReady(connection?: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Allocates one sequence value after queueing.
     * @param {import("../database/drivers/base.js").default} [connection] - Explicit record-owned connection.
     * @returns {Promise<number>} Allocated sequence value.
     */
    _allocateNext(connection?: import("../database/drivers/base.js").default): Promise<number>;
    /**
     * Builds the row payload inserted per allocation.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Insert payload.
     */
    _insertPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Resolves the configuration owning the sequence table.
     * @returns {import("../configuration.js").default} Resolved configuration.
     */
    _getConfiguration(): import("../configuration.js").default;
    /**
     * Whether the allocator runs without a configured database.
     * @returns {boolean} Whether memory storage is used.
     */
    _usesMemoryStorage(): boolean;
    /**
     * Runs a callback with a database connection.
     * @template Result
     * @param {(db: import("../database/drivers/base.js").default) => Promise<Result>} callback - Database callback.
     * @param {import("../database/drivers/base.js").default} [connection] - Explicit record-owned connection.
     * @returns {Promise<Result>} Callback result.
     */
    _withDb<Result>(callback: (db: import("../database/drivers/base.js").default) => Promise<Result>, connection?: import("../database/drivers/base.js").default): Promise<Result>;
    /**
     * Ensures the sequences table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} Whether the table had to be created.
     */
    _ensureSequencesTable(db: import("../database/drivers/base.js").default): Promise<boolean>;
}
/**
 * Wires server sequencing onto a sync model class: registers a beforeCreate
 * lifecycle callback assigning the next sequence when the record has none, and
 * defines an `advance<Column>()` instance method (when the model does not
 * already define one) that re-sequences the record through the allocator.
 *
 * The sequence is always written through the model's generated typed setter
 * (for example `setServerSequence`), so the model must expose the generated
 * `set<Column>`/`has<Column>` accessors for the column.
 * @template {typeof import("../database/record/index.js").default} TModelClass
 * @param {TModelClass} ModelClass - Sync model class to sequence.
 * @param {object} args - Options.
 * @param {ServerSequenceAllocator} args.allocator - Allocator providing sequence values.
 * @param {string} [args.column] - Sequence attribute name.
 * @returns {TModelClass} The given model class.
 */
export declare function withServerSequence<TModelClass extends typeof import("../database/record/index.js").default>(ModelClass: TModelClass, { allocator, column }: {
    allocator: ServerSequenceAllocator;
    column?: string;
}): TModelClass;
//# sourceMappingURL=server-sequence-allocator.d.ts.map