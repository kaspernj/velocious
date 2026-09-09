import TableIndex from "../table-data/table-index.js";
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
    sourceDb: import("../drivers/base.js").default;
    targetDb: import("../drivers/base.js").default;
    /**
     * Creates a cloner that copies table structure from `sourceDb` into `targetDb`.
     * @param {{sourceDb: import("../drivers/base.js").default, targetDb: import("../drivers/base.js").default}} args - Databases to clone structure from and into.
     */
    constructor({ sourceDb, targetDb }: {
        sourceDb: import("../drivers/base.js").default;
        targetDb: import("../drivers/base.js").default;
    });
    /**
     * Clones every given table from the source into the target, then baselines the
     * target's ledger so the cloned schema is recorded as already-migrated.
     * @param {string[]} tableNames - Source tables whose structure should be cloned.
     * @returns {Promise<void>}
     */
    syncTables(tableNames: string[]): Promise<void>;
    /**
     * Clones a single table from the source into the target, creating it or adding and
     * widening columns and indexes as needed.
     * @param {string} tableName - Source table to synchronize with the target.
     * @returns {Promise<void>}
     */
    syncTable(tableName: string): Promise<void>;
    /**
     * Creates the table in the target from the source table's columns and its
     * non-primary-key indexes.
     * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args - Source table metadata and target table name.
     * @returns {Promise<void>}
     */
    createTargetTable({ sourceTable, tableName }: {
        sourceTable: import("../drivers/base-table.js").default;
        tableName: string;
    }): Promise<void>;
    /**
     * Adds columns present on the source but missing from the target, and widens
     * too-narrow target text columns.
     * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args - Source table metadata and target table name.
     * @returns {Promise<boolean>} Whether any column was added or widened.
     */
    ensureTargetColumns({ sourceTable, tableName }: {
        sourceTable: import("../drivers/base-table.js").default;
        tableName: string;
    }): Promise<boolean>;
    /**
     * Creates non-primary-key indexes present on the source but missing from the target,
     * and replaces target indexes whose definition (columns or uniqueness) drifted from
     * the source.
     * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args - Source table metadata and target table name.
     * @returns {Promise<void>}
     */
    ensureTargetIndexes({ sourceTable, tableName }: {
        sourceTable: import("../drivers/base-table.js").default;
        tableName: string;
    }): Promise<void>;
    /**
     * Drops an index on the target database.
     * @param {{tableName: string, targetIndex: import("../drivers/base-columns-index.js").default}} args - Target table and index to remove.
     * @returns {Promise<void>}
     */
    dropTargetIndex({ tableName, targetIndex }: {
        tableName: string;
        targetIndex: import("../drivers/base-columns-index.js").default;
    }): Promise<void>;
    /**
     * Refuses index replacements that could fail after the existing index is dropped.
     * @param {{sourceIndex: import("../drivers/base-columns-index.js").default, tableName: string, targetIndex: import("../drivers/base-columns-index.js").default}} args - Source and target index definitions.
     * @returns {void}
     */
    assertSafeIndexReplacement({ sourceIndex, tableName, targetIndex }: {
        sourceIndex: import("../drivers/base-columns-index.js").default;
        tableName: string;
        targetIndex: import("../drivers/base-columns-index.js").default;
    }): void;
    /**
     * Baselines the target ledger so the cloned schema is recorded as already-applied.
     * @returns {Promise<string[]>} The versions newly recorded on the target.
     */
    reconcileLedger(): Promise<string[]>;
    /**
     * Whether the target ledger is missing any version applied on the source — i.e. the
     * target schema may have been advanced out of band without recording it.
     * @returns {Promise<boolean>} - Whether the target ledger differs from the source.
     */
    ledgerDriftsFromSource(): Promise<boolean>;
    /**
     * Maps a source index into a TableData index for table creation (SQLite omits the
     * index name so the driver can generate a unique one).
     * @param {import("../drivers/base-columns-index.js").default} sourceIndex - Source index definition.
     * @returns {TableIndex} - Framework-independent index definition.
     */
    tableDataIndexFromSourceIndex(sourceIndex: import("../drivers/base-columns-index.js").default): TableIndex;
    /**
     * Builds driver create-index args from a source index (the index name is omitted on
     * SQLite, where index names are unique per-database rather than per-table).
     * @param {{sourceIndex: import("../drivers/base-columns-index.js").default, tableName: string}} args - Source index and target table receiving it.
     * @returns {{columns: string[], name?: string, tableName: string, unique: boolean}} - Arguments for creating the target index.
     */
    createIndexArgsFromSourceIndex({ sourceIndex, tableName }: {
        sourceIndex: import("../drivers/base-columns-index.js").default;
        tableName: string;
    }): {
        columns: string[];
        name?: string;
        tableName: string;
        unique: boolean;
    };
    /**
     * Whether two indexes have the same uniqueness and ordered column list.
     * @param {import("../drivers/base-columns-index.js").default} sourceIndex - Source index definition.
     * @param {import("../drivers/base-columns-index.js").default} targetIndex - Target index definition.
     * @returns {boolean} - Whether both indexes have the same shape.
     */
    indexesMatch(sourceIndex: import("../drivers/base-columns-index.js").default, targetIndex: import("../drivers/base-columns-index.js").default): boolean;
    /**
     * A stable signature for an index, used to match cloned indexes by shape.
     * @param {import("../drivers/base-columns-index.js").default} index - Index definition.
     * @returns {string} - Stable index-shape signature.
     */
    indexSignature(index: import("../drivers/base-columns-index.js").default): string;
    /**
     * Normalizes a column type to its canonical lowercase form (`int` becomes `integer`).
     * @param {string} columnType - Database column type.
     * @returns {string} - Canonical lowercase column type.
     */
    normalizedColumnType(columnType: string): string;
    /**
     * The widening rank of a text column type (0 when not a text type).
     * @param {string} columnType - Database column type.
     * @returns {number} - Text-type widening rank.
     */
    textTypeRank(columnType: string): number;
    /**
     * Whether the target's text column is narrower than the source's and must be widened.
     * @param {import("../drivers/base-column.js").default} sourceColumn - Source column definition.
     * @param {import("../drivers/base-column.js").default} targetColumn - Target column definition.
     * @returns {boolean} - Whether the target text column must be widened.
     */
    columnNeedsWidening(sourceColumn: import("../drivers/base-column.js").default, targetColumn: import("../drivers/base-column.js").default): boolean;
    /**
     * Builds TableData column args from a source column, copying type, nullability,
     * length, notes, simple defaults and (for full clones) primary-key flag.
     * @param {import("../drivers/base-column.js").default} sourceColumn - Source column definition.
     * @param {{isNewColumn: boolean}} args - Whether the column is being added instead of cloned with its table.
     * @returns {Record<string, unknown>} - Arguments for altering the target column.
     */
    columnArgsFromSourceColumn(sourceColumn: import("../drivers/base-column.js").default, { isNewColumn }: {
        isNewColumn: boolean;
    }): Record<string, unknown>;
}
//# sourceMappingURL=schema-cloner.d.ts.map