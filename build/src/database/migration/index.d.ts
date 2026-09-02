export type AddColumnArgsType = import("../table-data/table-column.js").TableColumnArgsType;
export type CreateTableIdArgsType = {
    /**
     * - Default value for the ID column.
     */
    default?: ReturnType<typeof JSON.parse>;
    /**
     * - Column type for the ID column.
     */
    type?: string;
};
export type CreateTableArgsType = {
    /**
     * - Skip creation if the table already exists.
     */
    ifNotExists?: boolean;
    /**
     * - ID column options or false to skip ID.
     */
    id?: CreateTableIdArgsType | false;
};
export type CreateTableCallbackType = (table: TableData) => void;
export type LegacyLocalDateTimesMigrationArgsType = {
    /**
     * - Explicit datetime columns keyed by table name.
     */
    columnsByTable?: Record<string, string[]>;
    /**
     * - UTC-minus-local offset in minutes for legacy rows.
     */
    legacyLocalOffsetMinutes?: number;
    /**
     * - Tables to migrate. Defaults to all non-internal tables.
     */
    tables?: string[];
};
import TableData from "../table-data/index.js";
import TableIndex from "../table-data/table-index.js";
declare class NotImplementedError extends Error {
}
export { NotImplementedError };
export type AddIndexArgsType = {
    /**
     * - Skip creation if the index already exists.
     */
    ifNotExists?: boolean;
    /**
     * - Explicit index name to use.
     */
    name?: string;
    /**
     * - Whether the index should be unique.
     */
    unique?: boolean;
};
export type RemoveIndexArgsType = {
    /**
     * - Explicit index name to remove.
     */
    name?: string;
};
export type AddForeignKeyArgsType = {
    /**
     * - Override the derived FK column name (default: `${reference_underscored}_id`).
     */
    columnName?: string;
    /**
     * - Override the derived constraint name (default: `fk_${tableName}_${referenceName}`).
     */
    name?: string;
    /**
     * - Override the referenced column name (default: `id`).
     */
    referencedColumnName?: string;
    /**
     * - Override the derived referenced table (default: pluralized `referenceName`).
     */
    referencedTableName?: string;
};
export type RemoveForeignKeyArgsType = {
    /**
     * - Override the derived foreign-key column name.
     */
    columnName?: string;
};
export type RemoveReferenceArgsType = {
    /**
     * - Override the derived reference column name.
     */
    columnName?: string;
    /**
     * - Explicit generated index name to remove.
     */
    indexName?: string;
};
export type ChangeTableArgsType = {
    /**
     * - Combine compatible contiguous DDL into single
     * ALTER TABLE statements on drivers that support bulk alters (MySQL/MariaDB
     * and PostgreSQL). `bulk` controls DDL grouping only, not transactional
     * atomicity; unchanged drivers execute the recorded commands sequentially.
     */
    bulk?: boolean;
};
export type ChangeTableCallbackType = (table: import("./change-table.js").default) => void | Promise<void>;
export default class VelociousDatabaseMigration {
    static _databaseIdentifiers: string[] | undefined;
    configuration: import("../../configuration.js").default;
    _databaseIdentifier: string;
    _db: import("../drivers/base.js").default;
    /** @type {import("../migration-execution-phase.js").MigrationExecutionPhase | undefined} */
    static _executionPhase: import("../migration-execution-phase.js").MigrationExecutionPhase | undefined;
    /**
     * Declares when this migration is eligible to run.
     * @param {import("../migration-execution-phase.js").MigrationExecutionPhase} phase - Execution phase.
     * @returns {void} - No return value.
     */
    static runInPhase(phase: import("../migration-execution-phase.js").MigrationExecutionPhase): void;
    /**
     * Gets the declared execution phase.
     * @returns {import("../migration-execution-phase.js").MigrationExecutionPhase} - Declared execution phase.
     */
    static getExecutionPhase(): import("../migration-execution-phase.js").MigrationExecutionPhase;
    /**
     * Runs on databases.
     * @param {string[]} databaseIdentifiers - Database identifiers.
     * @returns {void} - No return value.
     */
    static onDatabases(databaseIdentifiers: string[]): void;
    /**
     * Runs get database identifiers.
     * @returns {string[] | undefined} - The database identifiers.
     */
    static getDatabaseIdentifiers(): string[] | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.databaseIdentifier - Database identifier.
     * @param {import("../drivers/base.js").default} args.db - Database connection.
     */
    constructor({ configuration, databaseIdentifier, db }: {
        configuration: import("../../configuration.js").default;
        databaseIdentifier: string;
        db: import("../drivers/base.js").default;
    });
    _getDatabaseIdentifier(): string;
    /**
     * Runs get driver.
     * @returns {import("../drivers/base.js").default} - The driver.
     */
    getDriver(): import("../drivers/base.js").default;
    connection(): import("../drivers/base.js").default;
    change(): Promise<void>;
    up(): Promise<void>;
    down(): Promise<void>;
    /**
     * Runs execute.
     * @param {string} sql - SQL string.
     * @returns {Promise<import("../drivers/base.js").QueryResultType>} - Resolves with the execute.
     */
    execute(sql: string): Promise<import("../drivers/base.js").QueryResultType>;
    /**
     * Runs add column.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @param {string} columnType - Column type.
     * @param {AddColumnArgsType} [args] - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    addColumn(tableName: string, columnName: string, columnType: string, args?: AddColumnArgsType): Promise<void>;
    /**
     * Runs remove column.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    removeColumn(tableName: string, columnName: string): Promise<void>;
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
    addIndex(tableName: string, columns: string | Array<string | import("../table-data/table-column.js").default>, args?: AddIndexArgsType): Promise<void>;
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
    removeIndex(tableName: string, nameOrColumns: string | Array<string | import("../table-data/table-column.js").default>, args?: RemoveIndexArgsType): Promise<void>;
    /**
     * Runs remove index name.
     * @param {string} tableName - Table name.
     * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
     * @returns {string} - The index name.
     */
    _removeIndexName(tableName: string, nameOrColumns: string | Array<string | import("../table-data/table-column.js").default>): string;
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
    addForeignKey(tableName: string, referenceName: string, args?: AddForeignKeyArgsType): Promise<void>;
    /**
     * RemoveForeignKeyArgsType type.
     * @typedef {object} RemoveForeignKeyArgsType
     * @property {string} [columnName] - Override the derived foreign-key column name.
     */
    /**
     * Runs remove foreign key.
     * @param {string} tableName - Table the foreign key lives on.
     * @param {string} referenceName - Singular reference name used to derive the FK column.
     * @param {RemoveForeignKeyArgsType} [args] - Optional overrides.
     * @returns {Promise<void>} - Resolves when complete.
     */
    removeForeignKey(tableName: string, referenceName: string, args?: RemoveForeignKeyArgsType): Promise<void>;
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
    addReference(tableName: string, referenceName: string, args: {
        foreignKey?: boolean;
        null?: boolean;
        type?: string;
        unique?: boolean;
    }): Promise<void>;
    /**
     * RemoveReferenceArgsType type.
     * @typedef {object} RemoveReferenceArgsType
     * @property {string} [columnName] - Override the derived reference column name.
     * @property {string} [indexName] - Explicit generated index name to remove.
     */
    /**
     * Runs remove reference.
     * @param {string} tableName - Table name.
     * @param {string} referenceName - Reference name.
     * @param {RemoveReferenceArgsType} [args] - Optional overrides.
     * @returns {Promise<void>} - Resolves when complete.
     */
    removeReference(tableName: string, referenceName: string, args?: RemoveReferenceArgsType): Promise<void>;
    /**
     * Runs change column null.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @param {boolean} nullable - Whether nullable.
     * @returns {Promise<void>} - Resolves when complete.
     */
    changeColumnNull(tableName: string, columnName: string, nullable: boolean): Promise<void>;
    /**
     * Migrates legacy timezone-less local datetime rows into UTC datetime storage.
     * New SQLite UTC rows include a timezone suffix and are skipped.
     * @param {LegacyLocalDateTimesMigrationArgsType} [args] - Migration options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    migrateLegacyLocalDateTimesToUtcStorage(args?: LegacyLocalDateTimesMigrationArgsType): Promise<void>;
    /**
     * Resolves table names for a legacy local datetime migration.
     * @param {string[] | undefined} tables - Explicit table names.
     * @returns {Promise<string[]>} - Table names.
     */
    _legacyLocalDateTimesTableNames(tables: string[] | undefined): Promise<string[]>;
    /**
     * Migrates one table's legacy local datetime values.
     * @param {object} args - Options.
     * @param {Record<string, string[]> | undefined} args.columnsByTable - Explicit columns keyed by table.
     * @param {number | undefined} args.legacyLocalOffsetMinutes - UTC-minus-local offset in minutes.
     * @param {string} args.tableName - Table name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _migrateLegacyLocalDateTimesTable({ columnsByTable, legacyLocalOffsetMinutes, tableName }: {
        columnsByTable: Record<string, string[]> | undefined;
        legacyLocalOffsetMinutes: number | undefined;
        tableName: string;
    }): Promise<void>;
    /**
     * Resolves date-like columns for one table.
     * @param {object} args - Options.
     * @param {Record<string, string[]> | undefined} args.columnsByTable - Explicit columns keyed by table.
     * @param {import("../drivers/base-table.js").default} args.table - Table metadata.
     * @returns {Promise<string[]>} - Date-like column names.
     */
    _legacyLocalDateTimesColumns({ columnsByTable, table }: {
        columnsByTable: Record<string, string[]> | undefined;
        table: import("../drivers/base-table.js").default;
    }): Promise<string[]>;
    /**
     * Checks whether a column should be included by default.
     * @param {import("../drivers/base-column.js").default} column - Column metadata.
     * @returns {boolean} - Whether the column is date-like.
     */
    _legacyLocalDateTimesColumnIsDateLike(column: import("../drivers/base-column.js").default): boolean;
    /**
     * Resolves the single primary key column for row updates.
     * @param {import("../drivers/base-table.js").default} table - Table metadata.
     * @returns {Promise<string>} - Primary key column name.
     */
    _legacyLocalDateTimesPrimaryKey(table: import("../drivers/base-table.js").default): Promise<string>;
    /**
     * Runs column exists.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @returns {Promise<boolean>} - Resolves with Whether column exists.
     */
    columnExists(tableName: string, columnName: string): Promise<boolean>;
    /**
     * Checks whether an index with the given name exists on a table.
     * @param {string} tableName - Table name.
     * @param {string} indexName - Index name to look for.
     * @returns {Promise<boolean>} - Whether the index exists on the table.
     */
    indexExists(tableName: string, indexName: string): Promise<boolean>;
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
    addActsAsList(tableName: string, positionColumn: string, { scope }: {
        scope: string;
    }): Promise<void>;
    createTable(tableName: string, callback: CreateTableCallbackType): Promise<void>;
    createTable(tableName: string, args: CreateTableArgsType, callback: CreateTableCallbackType): Promise<void>;
    changeTable(tableName: string, callback: ChangeTableCallbackType): Promise<void>;
    changeTable(tableName: string, args: ChangeTableArgsType, callback: ChangeTableCallbackType): Promise<void>;
    /**
     * Executes recorded changeTable operations. With `bulk` enabled on a
     * supporting driver, compatible contiguous column operations accumulate into
     * a single TableData flushed through `alterTableSQLs`; incompatible commands
     * flush the batch first and run through the existing migration helpers.
     * @param {string} tableName - Table name.
     * @param {import("./change-table.js").ChangeTableOperationType[]} operations - Recorded operations.
     * @param {object} args - Options object.
     * @param {boolean} args.bulk - Whether to enable bulk command grouping.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _executeChangeTableOperations(tableName: string, operations: import("./change-table.js").ChangeTableOperationType[], { bulk }: {
        bulk: boolean;
    }): Promise<void>;
    /**
     * Builds a TableIndex for a batch from a recorded addIndex operation,
     * resolving the default addIndex name eagerly so a combined MySQL ALTER
     * never silently names the index differently.
     * @param {string} tableName - Table name.
     * @param {import("./change-table.js").ChangeTableAddIndexOperationType} operation - Recorded operation.
     * @returns {TableIndex} - The table index.
     */
    _changeTableTableIndex(tableName: string, operation: import("./change-table.js").ChangeTableAddIndexOperationType): TableIndex;
    /**
     * Executes a single recorded changeTable operation through the existing
     * migration helper with the same semantics as a direct helper call.
     * @param {string} tableName - Table name.
     * @param {import("./change-table.js").ChangeTableOperationType} operation - Recorded operation.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _executeChangeTableOperation(tableName: string, operation: import("./change-table.js").ChangeTableOperationType): Promise<void>;
    /**
     * Runs drop table.
     * @param {string} tableName - Table name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    dropTable(tableName: string): Promise<void>;
    /**
     * Runs rename column.
     * @param {string} tableName - Table name.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    renameColumn(tableName: string, oldColumnName: string, newColumnName: string): Promise<void>;
    /**
     * Runs table exists.
     * @param {string} tableName - Table name.
     * @returns {Promise<boolean>} - Resolves with Whether table exists.
     */
    tableExists(tableName: string): Promise<boolean>;
    /**
     * Helper: creates the shared audit tables (`audit_actions`,
     * `audit_auditable_types`, `audits`). Call from `up()` in a migration.
     * @param {{id?: {type?: string}}} [options] - ID column options.
     * @returns {Promise<void>}
     */
    createSharedAuditTables(options?: {
        id?: {
            type?: string;
        };
    }): Promise<void>;
    /**
     * Helper: creates a dedicated audit table for a model (e.g.
     * `project_audits` for the `projects` table). Call from `up()`
     * in a migration.
     * @param {string} modelTableName - Model table name (e.g. "projects").
     * @param {{id?: {type?: string}}} [options] - ID column options.
     * @returns {Promise<string>} The created audit table name.
     */
    createDedicatedAuditTable(modelTableName: string, options?: {
        id?: {
            type?: string;
        };
    }): Promise<string>;
}
/**
 * Returns the dedicated audit table name for a model table.
 * @param {string} modelTableName - Model table name (e.g. "projects").
 * @returns {string} Dedicated audit table name (e.g. "project_audits").
 */
export declare function dedicatedAuditTableName(modelTableName: string): string;
//# sourceMappingURL=index.d.ts.map