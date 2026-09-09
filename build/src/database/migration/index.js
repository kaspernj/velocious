// @ts-check
/** @typedef {import("../table-data/table-column.js").TableColumnArgsType} AddColumnArgsType */
/**
 * CreateTableIdArgsType type.
 * @typedef {object} CreateTableIdArgsType
 * @property {ReturnType<typeof JSON.parse>} [default] - Default value for the ID column.
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
import { convertLegacyDateValueToUtcStorage } from "../datetime-storage.js";
import * as inflection from "inflection";
import restArgsError from "../../utils/rest-args-error.js";
import { DEFAULT_MIGRATION_EXECUTION_PHASE, migrationExecutionPhase } from "../migration-execution-phase.js";
import ChangeTable from "./change-table.js";
import CreateIndexBase from "../query/create-index-base.js";
import TableColumn from "../table-data/table-column.js";
import TableData from "../table-data/index.js";
import TableIndex from "../table-data/table-index.js";
class NotImplementedError extends Error {
}
export { NotImplementedError };
export default class VelociousDatabaseMigration {
    /** @type {import("../migration-execution-phase.js").MigrationExecutionPhase | undefined} */
    static _executionPhase;
    /**
     * Declares when this migration is eligible to run.
     * @param {import("../migration-execution-phase.js").MigrationExecutionPhase} phase - Execution phase.
     * @returns {void} - No return value.
     */
    static runInPhase(phase) {
        this._executionPhase = migrationExecutionPhase(phase);
    }
    /**
     * Gets the declared execution phase.
     * @returns {import("../migration-execution-phase.js").MigrationExecutionPhase} - Declared execution phase.
     */
    static getExecutionPhase() {
        return this._executionPhase || DEFAULT_MIGRATION_EXECUTION_PHASE;
    }
    /**
     * Runs on databases.
     * @param {string[]} databaseIdentifiers - Database identifiers.
     * @returns {void} - No return value.
     */
    static onDatabases(databaseIdentifiers) {
        this._databaseIdentifiers = databaseIdentifiers;
    }
    /**
     * Runs get database identifiers.
     * @returns {string[] | undefined} - The database identifiers.
     */
    static getDatabaseIdentifiers() {
        return this._databaseIdentifiers;
    }
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.databaseIdentifier - Database identifier.
     * @param {import("../drivers/base.js").default} args.db - Database connection.
     */
    constructor({ configuration, databaseIdentifier = "default", db }) {
        if (!databaseIdentifier)
            throw new Error("No database identifier given");
        if (!db)
            throw new Error("No 'db' given");
        this.configuration = configuration;
        this._databaseIdentifier = databaseIdentifier;
        this._db = db;
    }
    _getDatabaseIdentifier() {
        if (!this._databaseIdentifier)
            throw new Error("No database identifier set");
        return this._databaseIdentifier;
    }
    /**
     * Runs get driver.
     * @returns {import("../drivers/base.js").default} - The driver.
     */
    getDriver() { return this._db; }
    connection() { return this.getDriver(); }
    async change() {
        throw new NotImplementedError("'change' not implemented");
    }
    async up() {
        throw new NotImplementedError("'change' not implemented");
    }
    async down() {
        throw new NotImplementedError("'change' not implemented");
    }
    /**
     * Runs execute.
     * @param {string} sql - SQL string.
     * @returns {Promise<import("../drivers/base.js").QueryResultType>} - Resolves with the execute.
     */
    async execute(sql) {
        return await this.connection().query(sql);
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
        if (!columnType)
            throw new Error("No column type given");
        const tableColumnArgs = Object.assign({ isNewColumn: true, type: columnType }, args);
        const tableData = new TableData(tableName);
        tableData.addColumn(columnName, tableColumnArgs);
        const sqls = await this.getDriver().alterTableSQLs(tableData);
        for (const sql of sqls) {
            await this.getDriver().query(sql);
        }
    }
    /**
     * Runs remove column.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async removeColumn(tableName, columnName) {
        const tableColumnArgs = Object.assign({ dropColumn: true });
        const tableData = new TableData(tableName);
        tableData.addColumn(columnName, tableColumnArgs);
        const sqls = await this.getDriver().alterTableSQLs(tableData);
        for (const sql of sqls) {
            await this.getDriver().query(sql);
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
        const normalizedColumns = typeof columns === "string" ? [columns] : columns;
        const createIndexArgs = Object.assign({
            columns: normalizedColumns,
            tableName
        }, args);
        const sqls = await this.getDriver().createIndexSQLs(createIndexArgs);
        for (const sql of sqls) {
            await this.getDriver().query(sql);
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
        const { name, ...restArgs } = args;
        restArgsError(restArgs);
        const removeIndexName = name || this._removeIndexName(tableName, nameOrColumns);
        const sqls = await this.getDriver().removeIndexSQLs({ name: removeIndexName, tableName });
        for (const sql of sqls) {
            await this.getDriver().query(sql);
        }
    }
    /**
     * Runs remove index name.
     * @param {string} tableName - Table name.
     * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
     * @returns {string} - The index name.
     */
    _removeIndexName(tableName, nameOrColumns) {
        if (typeof nameOrColumns === "string")
            return nameOrColumns;
        const createIndex = new CreateIndexBase({
            columns: nameOrColumns,
            driver: this.getDriver(),
            tableName
        });
        return createIndex.generateIndexName();
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
        const { columnName, name, referencedColumnName, referencedTableName, ...restArgs } = args;
        restArgsError(restArgs);
        const referenceNameUnderscore = inflection.underscore(referenceName);
        const resolvedReferencedTableName = referencedTableName || inflection.pluralize(referenceNameUnderscore);
        const resolvedColumnName = columnName || `${referenceNameUnderscore}_id`;
        const resolvedReferencedColumnName = referencedColumnName || "id";
        const resolvedName = name || `fk_${tableName}_${referenceName}`;
        await this.getDriver().addForeignKey(tableName, resolvedColumnName, resolvedReferencedTableName, resolvedReferencedColumnName, {
            isNewForeignKey: true,
            name: resolvedName
        });
    }
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
    async removeForeignKey(tableName, referenceName, args = {}) {
        const { columnName, ...restArgs } = args;
        restArgsError(restArgs);
        const resolvedColumnName = columnName || `${inflection.underscore(referenceName)}_id`;
        const driver = this.getDriver();
        let maximumRemovals = 0;
        let previousMatchingCount = 0;
        for (let removalAttempt = 0;; removalAttempt++) {
            const table = await driver.getTableByName(tableName);
            if (!table)
                throw new Error(`Table ${tableName} does not exist`);
            const foreignKeys = await table.getForeignKeys();
            const matchingForeignKeys = foreignKeys.filter((foreignKey) => foreignKey.getColumnName() == resolvedColumnName);
            if (matchingForeignKeys.length === 0) {
                if (removalAttempt === 0)
                    throw new Error(`No foreign key on ${tableName}.${resolvedColumnName}`);
                return;
            }
            if (removalAttempt === 0) {
                maximumRemovals = matchingForeignKeys.length;
            }
            else if (matchingForeignKeys.length >= previousMatchingCount) {
                throw new Error(`Foreign key removal did not reduce matches on ${tableName}.${resolvedColumnName}`);
            }
            if (removalAttempt >= maximumRemovals) {
                throw new Error(`Foreign key removal exceeded expected matches on ${tableName}.${resolvedColumnName}`);
            }
            previousMatchingCount = matchingForeignKeys.length;
            await driver.removeForeignKey(tableName, matchingForeignKeys[0]);
        }
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
        const { foreignKey, null: nullable, type, unique, ...restArgs } = args;
        const columnName = `${inflection.underscore(referenceName)}_id`;
        restArgsError(restArgs);
        const columnType = type || "integer";
        const columnArgs = nullable !== undefined ? { null: nullable } : undefined;
        await this.addColumn(tableName, columnName, columnType, columnArgs);
        await this.addIndex(tableName, [columnName], { unique: unique });
        if (foreignKey) {
            await this.addForeignKey(tableName, referenceName);
        }
    }
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
    async removeReference(tableName, referenceName, args = {}) {
        const { columnName, indexName, ...restArgs } = args;
        restArgsError(restArgs);
        const resolvedColumnName = columnName || `${inflection.underscore(referenceName)}_id`;
        const driver = this.getDriver();
        const table = await driver.getTableByName(tableName);
        if (!table)
            throw new Error(`Table ${tableName} does not exist`);
        const foreignKeys = await table.getForeignKeys();
        for (const foreignKey of foreignKeys) {
            if (foreignKey.getColumnName() != resolvedColumnName)
                continue;
            await driver.removeForeignKey(tableName, foreignKey);
        }
        const expectedIndexName = indexName || this._removeIndexName(tableName, [resolvedColumnName]);
        const indexes = await table.getIndexes();
        const generatedIndex = indexes.find((index) => {
            const indexColumnNames = index.getColumnNames();
            return !index.isPrimaryKey() &&
                index.getName() == expectedIndexName &&
                indexColumnNames.length == 1 &&
                indexColumnNames[0] == resolvedColumnName;
        });
        if (generatedIndex) {
            await this.removeIndex(tableName, generatedIndex.getName());
        }
        await this.removeColumn(tableName, resolvedColumnName);
    }
    /**
     * Runs change column null.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @param {boolean} nullable - Whether nullable.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async changeColumnNull(tableName, columnName, nullable) {
        const table = await this.getDriver().getTableByName(tableName);
        if (!table)
            throw new Error(`Table ${tableName} does not exist`);
        const column = await table.getColumnByName(columnName);
        if (!column)
            throw new Error(`Column ${columnName} does not exist in table ${tableName}`);
        await column.changeNullable(nullable);
    }
    /**
     * Migrates legacy timezone-less local datetime rows into UTC datetime storage.
     * New SQLite UTC rows include a timezone suffix and are skipped.
     * @param {LegacyLocalDateTimesMigrationArgsType} [args] - Migration options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async migrateLegacyLocalDateTimesToUtcStorage(args = {}) {
        const { columnsByTable, legacyLocalOffsetMinutes, tables, ...restArgs } = args;
        restArgsError(restArgs);
        const tableNames = await this._legacyLocalDateTimesTableNames(tables);
        for (const tableName of tableNames) {
            await this._migrateLegacyLocalDateTimesTable({
                columnsByTable,
                legacyLocalOffsetMinutes,
                tableName
            });
        }
    }
    /**
     * Resolves table names for a legacy local datetime migration.
     * @param {string[] | undefined} tables - Explicit table names.
     * @returns {Promise<string[]>} - Table names.
     */
    async _legacyLocalDateTimesTableNames(tables) {
        if (tables)
            return tables;
        return (await this.getDriver().getTables())
            .map((table) => table.getName())
            .filter((tableName) => tableName != "schema_migrations" && !tableName.startsWith("sqlite_"));
    }
    /**
     * Migrates one table's legacy local datetime values.
     * @param {object} args - Options.
     * @param {Record<string, string[]> | undefined} args.columnsByTable - Explicit columns keyed by table.
     * @param {number | undefined} args.legacyLocalOffsetMinutes - UTC-minus-local offset in minutes.
     * @param {string} args.tableName - Table name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _migrateLegacyLocalDateTimesTable({ columnsByTable, legacyLocalOffsetMinutes, tableName }) {
        const driver = this.getDriver();
        const table = await driver.getTableByNameOrFail(tableName);
        const columns = await this._legacyLocalDateTimesColumns({ columnsByTable, table });
        if (columns.length === 0)
            return;
        const primaryKeyColumn = await this._legacyLocalDateTimesPrimaryKey(table);
        const selectedColumns = [primaryKeyColumn, ...columns];
        const selectSql = selectedColumns
            .map((columnName) => driver.quoteColumn(columnName))
            .join(", ");
        const rows = await driver.query(`SELECT ${selectSql} FROM ${driver.quoteTable(tableName)}`);
        for (const row of rows) {
            for (const columnName of columns) {
                const value = row[columnName];
                const convertedValue = convertLegacyDateValueToUtcStorage(value, {
                    databaseType: driver.getType(),
                    legacyLocalOffsetMinutes
                });
                if (convertedValue === value)
                    continue;
                await driver.query(`
          UPDATE ${driver.quoteTable(tableName)}
          SET ${driver.quoteColumn(columnName)} = ${driver.quote(convertedValue)}
          WHERE ${driver.quoteColumn(primaryKeyColumn)} = ${driver.quote(row[primaryKeyColumn])}
        `);
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
    async _legacyLocalDateTimesColumns({ columnsByTable, table }) {
        const explicitColumns = columnsByTable?.[table.getName()];
        if (explicitColumns)
            return explicitColumns;
        return (await table.getColumns())
            .filter((column) => this._legacyLocalDateTimesColumnIsDateLike(column))
            .map((column) => column.getName());
    }
    /**
     * Checks whether a column should be included by default.
     * @param {import("../drivers/base-column.js").default} column - Column metadata.
     * @returns {boolean} - Whether the column is date-like.
     */
    _legacyLocalDateTimesColumnIsDateLike(column) {
        const columnType = column.getType().toLowerCase();
        return columnType.includes("date") || columnType.includes("timestamp");
    }
    /**
     * Resolves the single primary key column for row updates.
     * @param {import("../drivers/base-table.js").default} table - Table metadata.
     * @returns {Promise<string>} - Primary key column name.
     */
    async _legacyLocalDateTimesPrimaryKey(table) {
        const primaryKeyColumns = (await table.getColumns()).filter((column) => column.getPrimaryKey());
        if (primaryKeyColumns.length != 1) {
            throw new Error(`Expected exactly one primary key on ${table.getName()} but found ${primaryKeyColumns.length}`);
        }
        return primaryKeyColumns[0].getName();
    }
    /**
     * Runs column exists.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @returns {Promise<boolean>} - Resolves with Whether column exists.
     */
    async columnExists(tableName, columnName) {
        const table = await this.getDriver().getTableByName(tableName);
        if (table) {
            const column = await table.getColumnByName(columnName);
            if (column) {
                return true;
            }
        }
        return Boolean(false);
    }
    /**
     * Checks whether an index with the given name exists on a table.
     * @param {string} tableName - Table name.
     * @param {string} indexName - Index name to look for.
     * @returns {Promise<boolean>} - Whether the index exists on the table.
     */
    async indexExists(tableName, indexName) {
        const table = await this.getDriver().getTableByName(tableName, { throwError: false });
        if (table) {
            for (const index of await table.getIndexes()) {
                if (index.getName() == indexName) {
                    return true;
                }
            }
        }
        return false;
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
    async addActsAsList(tableName, positionColumn, { scope }) {
        if (!(await this.columnExists(tableName, positionColumn))) {
            await this.addColumn(tableName, positionColumn, "integer", { null: false });
        }
        else {
            await this.changeColumnNull(tableName, positionColumn, false);
        }
        await this.addIndex(tableName, [scope, positionColumn], { unique: true });
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
        let args;
        let callback;
        if (typeof arg1 == "function") {
            args = {};
            callback = arg1;
        }
        else {
            args = arg1;
            callback = arg2;
        }
        const { id = {}, ifNotExists = false, ...restArgs } = args;
        const driver = this.getDriver();
        const defaultPrimaryKeyType = driver.primaryKeyType();
        let idDefault, idType, restArgsId;
        if (id !== false) {
            ({ default: idDefault, type: idType, ...restArgsId } = id);
            restArgsError(restArgsId);
        }
        if (!idType) {
            idType = defaultPrimaryKeyType;
        }
        const driverSupportsDefaultUUID = driver.supportsDefaultPrimaryKeyUUID?.();
        const lowerIdType = idType?.toLowerCase();
        const isUUIDPrimaryKey = lowerIdType == "uuid";
        const numericAutoIncrementTypes = ["int", "integer", "bigint", "smallint", "tinyint"];
        let idAutoIncrement = numericAutoIncrementTypes.includes(lowerIdType || "");
        if (isUUIDPrimaryKey) {
            idAutoIncrement = false;
            if (driverSupportsDefaultUUID) {
                if (idDefault === undefined) {
                    idDefault = () => "UUID()";
                }
            }
            else if (idDefault === undefined) {
                // Let application code assign UUIDs (see DatabaseRecord.insert) when the driver can't do it.
                idDefault = undefined;
            }
            // If driver doesn't support UUID() but the caller explicitly set a default, respect it.
        }
        const tableData = new TableData(tableName, { ifNotExists, primaryKeyType: defaultPrimaryKeyType });
        restArgsError(restArgs);
        if (!(idType in tableData))
            throw new Error(`Unsupported primary key type: ${idType}`);
        if (id !== false) {
            tableData.addColumn("id", { autoIncrement: idAutoIncrement, default: idDefault, null: false, primaryKey: true, type: idType });
        }
        if (callback) {
            callback(tableData);
        }
        const sqls = await driver.createTableSql(tableData);
        for (const sql of sqls) {
            await this._db.query(sql);
        }
    }
    /**
     * ChangeTableArgsType type.
     * @typedef {object} ChangeTableArgsType
     * @property {boolean} [bulk] - Combine compatible contiguous DDL into single
     *   ALTER TABLE statements on drivers that support bulk alters (MySQL/MariaDB
     *   and PostgreSQL). `bulk` controls DDL grouping only, not transactional
     *   atomicity; unchanged drivers execute the recorded commands sequentially.
     */
    /**
     * ChangeTableCallbackType type.
     * @typedef {(table: import("./change-table.js").default) => void | Promise<void>} ChangeTableCallbackType
     */
    /**
     * Changes a table using a Rails-style table-scoped recorder.
     * @overload
     * @param {string} tableName - Table name.
     * @param {ChangeTableCallbackType} callback - Callback function.
     * @returns {Promise<void>} - Resolves when complete.
     */
    /**
     * Changes a table with explicit options.
     * @overload
     * @param {string} tableName - Table name.
     * @param {ChangeTableArgsType} args - Options object.
     * @param {ChangeTableCallbackType} callback - Callback function.
     * @returns {Promise<void>} - Resolves when complete.
     */
    /**
     * Runs change table.
     * @param {string} tableName - Table name.
     * @param {ChangeTableArgsType | ChangeTableCallbackType} arg1 - Arg1.
     * @param {ChangeTableCallbackType | undefined} [arg2] - Arg2.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async changeTable(tableName, arg1, arg2) {
        let args = /** @type {ChangeTableArgsType} */ ({});
        let callback;
        if (typeof arg1 == "function") {
            callback = arg1;
        }
        else {
            args = arg1 || {};
            callback = arg2;
        }
        if (typeof callback != "function")
            throw new Error("No callback given");
        const { bulk = false, ...restArgs } = args;
        restArgsError(restArgs);
        const table = new ChangeTable({ tableName });
        await callback(table);
        await this._executeChangeTableOperations(tableName, table.getOperations(), { bulk });
    }
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
    async _executeChangeTableOperations(tableName, operations, { bulk }) {
        const driver = this.getDriver();
        const bulkSupported = bulk && driver.supportsBulkAlter();
        if (!bulkSupported) {
            for (const operation of operations) {
                await this._executeChangeTableOperation(tableName, operation);
            }
            return;
        }
        let batch = new TableData(tableName);
        const flushBatch = async () => {
            if (batch.getColumns().length == 0 && batch.getIndexes().length == 0)
                return;
            const sqls = await driver.alterTableSQLs(batch);
            for (const sql of sqls) {
                await driver.query(sql);
            }
            batch = new TableData(tableName);
        };
        for (const operation of operations) {
            switch (operation.type) {
                case "addColumn": {
                    if (!operation.columnType)
                        throw new Error("No column type given");
                    // Flush an already-recorded index batch first so the emitted SQL keeps
                    // the recorded declaration order (index before column).
                    if (batch.getIndexes().length > 0)
                        await flushBatch();
                    batch.addColumn(new TableColumn(operation.columnName, Object.assign({ isNewColumn: true, type: operation.columnType }, operation.args)));
                    break;
                }
                case "removeColumn":
                    // Flush an already-recorded index batch first so the emitted SQL keeps
                    // the recorded declaration order (index before column).
                    if (batch.getIndexes().length > 0)
                        await flushBatch();
                    batch.addColumn(new TableColumn(operation.columnName, { dropColumn: true }));
                    break;
                case "addIndex":
                    // Drivers without `supportsBulkAlterIndexes` (PostgreSQL) keep indexes
                    // standalone because their ALTER TABLE does not carry CREATE INDEX
                    // clauses. An ifNotExists index is never combined because the combined
                    // bulk form cannot express that guard.
                    if (!driver.supportsBulkAlterIndexes() || operation.args?.ifNotExists) {
                        await flushBatch();
                        await this._executeChangeTableOperation(tableName, operation);
                    }
                    else {
                        batch.addIndex(this._changeTableTableIndex(tableName, operation));
                    }
                    break;
                default:
                    await flushBatch();
                    await this._executeChangeTableOperation(tableName, operation);
            }
        }
        await flushBatch();
    }
    /**
     * Builds a TableIndex for a batch from a recorded addIndex operation,
     * resolving the default addIndex name eagerly so a combined MySQL ALTER
     * never silently names the index differently.
     * @param {string} tableName - Table name.
     * @param {import("./change-table.js").ChangeTableAddIndexOperationType} operation - Recorded operation.
     * @returns {TableIndex} - The table index.
     */
    _changeTableTableIndex(tableName, operation) {
        const { args, columns } = operation;
        // An ifNotExists index never reaches batching (it is flushed standalone),
        // so the combined ALTER cannot carry that guard.
        const { name, ...restIndexArgs } = args || {};
        const indexName = name || new CreateIndexBase({ columns, driver: this.getDriver(), tableName }).generateIndexName();
        return new TableIndex(columns, Object.assign({}, restIndexArgs, { name: indexName }));
    }
    /**
     * Executes a single recorded changeTable operation through the existing
     * migration helper with the same semantics as a direct helper call.
     * @param {string} tableName - Table name.
     * @param {import("./change-table.js").ChangeTableOperationType} operation - Recorded operation.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _executeChangeTableOperation(tableName, operation) {
        switch (operation.type) {
            case "addColumn":
                await this.addColumn(tableName, operation.columnName, operation.columnType, operation.args);
                break;
            case "removeColumn":
                await this.removeColumn(tableName, operation.columnName);
                break;
            case "addIndex":
                await this.addIndex(tableName, operation.columns, operation.args);
                break;
            case "removeIndex":
                await this.removeIndex(tableName, operation.nameOrColumns, operation.args);
                break;
            case "addReference":
                await this.addReference(tableName, operation.referenceName, operation.args || {});
                break;
            case "removeReference":
                await this.removeReference(tableName, operation.referenceName, operation.args);
                break;
            case "renameColumn":
                await this.renameColumn(tableName, operation.oldColumnName, operation.newColumnName);
                break;
            case "changeColumnNull":
                await this.changeColumnNull(tableName, operation.columnName, operation.nullable);
                break;
            default:
                throw new Error("Unknown change table operation");
        }
    }
    /**
     * Runs drop table.
     * @param {string} tableName - Table name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async dropTable(tableName) {
        await this.getDriver().dropTable(tableName);
    }
    /**
     * Runs rename column.
     * @param {string} tableName - Table name.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async renameColumn(tableName, oldColumnName, newColumnName) {
        await this.getDriver().renameColumn(tableName, oldColumnName, newColumnName);
    }
    /**
     * Runs table exists.
     * @param {string} tableName - Table name.
     * @returns {Promise<boolean>} - Resolves with Whether table exists.
     */
    async tableExists(tableName) {
        const exists = await this.getDriver().tableExists(tableName);
        return exists;
    }
    /**
     * Helper: creates the shared audit tables (`audit_actions`,
     * `audit_auditable_types`, `audits`). Call from `up()` in a migration.
     * @param {{id?: {type?: string}}} [options] - ID column options.
     * @returns {Promise<void>}
     */
    async createSharedAuditTables(options = {}) {
        const id = options.id || {};
        await this.createTable("audit_actions", { id }, (table) => {
            table.string("action", { index: { unique: true }, null: false });
            table.timestamps();
        });
        await this.createTable("audit_auditable_types", { id }, (table) => {
            table.string("name", { index: { unique: true }, null: false });
            table.timestamps();
        });
        await this.createTable("audits", { id }, (table) => {
            table.references("audit_action", { foreignKey: true, null: false });
            table.references("audit_auditable_type", { foreignKey: true, null: false });
            table.references("auditable", { null: false, polymorphic: true });
            table.json("audited_changes");
            table.json("params");
            table.timestamps();
        });
    }
    /**
     * Helper: creates a dedicated audit table for a model (e.g.
     * `project_audits` for the `projects` table). Call from `up()`
     * in a migration.
     * @param {string} modelTableName - Model table name (e.g. "projects").
     * @param {{id?: {type?: string}}} [options] - ID column options.
     * @returns {Promise<string>} The created audit table name.
     */
    async createDedicatedAuditTable(modelTableName, options = {}) {
        const auditTable = dedicatedAuditTableName(modelTableName);
        const id = options.id || {};
        await this.createTable(auditTable, { id }, (table) => {
            const refKey = inflection.singularize(modelTableName);
            table.references(refKey, { foreignKey: true, null: false });
            table.references("audit_action", { foreignKey: true, null: false });
            table.json("audited_changes");
            table.json("params");
            table.timestamps();
        });
        return auditTable;
    }
}
/**
 * Returns the dedicated audit table name for a model table.
 * @param {string} modelTableName - Model table name (e.g. "projects").
 * @returns {string} Dedicated audit table name (e.g. "project_audits").
 */
export function dedicatedAuditTableName(modelTableName) {
    if (modelTableName.endsWith("s")) {
        return `${modelTableName.slice(0, -1)}_audits`;
    }
    return `${modelTableName}_audits`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0aW9uL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWiwrRkFBK0Y7QUFDL0Y7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7R0FHRztBQUNIOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBRSxrQ0FBa0MsRUFBRSxNQUFNLHdCQUF3QixDQUFBO0FBQzNFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBQzFELE9BQU8sRUFBRSxpQ0FBaUMsRUFBRSx1QkFBdUIsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBQzVHLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sV0FBVyxNQUFNLCtCQUErQixDQUFBO0FBQ3ZELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sVUFBVSxNQUFNLDhCQUE4QixDQUFBO0FBQ3JELE1BQU0sbUJBQW9CLFNBQVEsS0FBSztDQUFHO0FBRTFDLE9BQU8sRUFBQyxtQkFBbUIsRUFBQyxDQUFBO0FBRTVCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sMEJBQTBCO0lBQzdDLDRGQUE0RjtJQUM1RixNQUFNLENBQUMsZUFBZSxDQUFBO0lBRXRCOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLEtBQUs7UUFDckIsSUFBSSxDQUFDLGVBQWUsR0FBRyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUN2RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLGlCQUFpQjtRQUN0QixPQUFPLElBQUksQ0FBQyxlQUFlLElBQUksaUNBQWlDLENBQUE7SUFDbEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENB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QVUsQ0FBQyxNQUFNLEVBQUUsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ3pELEtBQUssQ0FBQyxVQUFVLENBQUMsY0FBYyxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUNqRSxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDN0IsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNwQixLQUFLLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDcEIsQ0FBQyxDQUFDLENBQUE7UUFFRixPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0NBQ0Y7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLHVCQUF1QixDQUFDLGNBQWM7SUFDcEQsSUFBSSxjQUFjLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakMsT0FBTyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtJQUNoRCxDQUFDO0lBRUQsT0FBTyxHQUFHLGNBQWMsU0FBUyxDQUFBO0FBQ25DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBBZGRDb2x1bW5BcmdzVHlwZSAqL1xuLyoqXG4gKiBDcmVhdGVUYWJsZUlkQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENyZWF0ZVRhYmxlSWRBcmdzVHlwZVxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RlZmF1bHRdIC0gRGVmYXVsdCB2YWx1ZSBmb3IgdGhlIElEIGNvbHVtbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBDb2x1bW4gdHlwZSBmb3IgdGhlIElEIGNvbHVtbi5cbiAqL1xuLyoqXG4gKiBDcmVhdGVUYWJsZUFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVUYWJsZUFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSB0YWJsZSBhbHJlYWR5IGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7Q3JlYXRlVGFibGVJZEFyZ3NUeXBlIHwgZmFsc2V9IFtpZF0gLSBJRCBjb2x1bW4gb3B0aW9ucyBvciBmYWxzZSB0byBza2lwIElELlxuICovXG4vKipcbiAqIENyZWF0ZVRhYmxlQ2FsbGJhY2tUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7KHRhYmxlOiBUYWJsZURhdGEpID0+IHZvaWR9IENyZWF0ZVRhYmxlQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogTGVnYWN5TG9jYWxEYXRlVGltZXNNaWdyYXRpb25BcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gTGVnYWN5TG9jYWxEYXRlVGltZXNNaWdyYXRpb25BcmdzVHlwZVxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IFtjb2x1bW5zQnlUYWJsZV0gLSBFeHBsaWNpdCBkYXRldGltZSBjb2x1bW5zIGtleWVkIGJ5IHRhYmxlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xlZ2FjeUxvY2FsT2Zmc2V0TWludXRlc10gLSBVVEMtbWludXMtbG9jYWwgb2Zmc2V0IGluIG1pbnV0ZXMgZm9yIGxlZ2FjeSByb3dzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW3RhYmxlc10gLSBUYWJsZXMgdG8gbWlncmF0ZS4gRGVmYXVsdHMgdG8gYWxsIG5vbi1pbnRlcm5hbCB0YWJsZXMuXG4gKi9cblxuaW1wb3J0IHsgY29udmVydExlZ2FjeURhdGVWYWx1ZVRvVXRjU3RvcmFnZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgeyBERUZBVUxUX01JR1JBVElPTl9FWEVDVVRJT05fUEhBU0UsIG1pZ3JhdGlvbkV4ZWN1dGlvblBoYXNlIH0gZnJvbSBcIi4uL21pZ3JhdGlvbi1leGVjdXRpb24tcGhhc2UuanNcIlxuaW1wb3J0IENoYW5nZVRhYmxlIGZyb20gXCIuL2NoYW5nZS10YWJsZS5qc1wiXG5pbXBvcnQgQ3JlYXRlSW5kZXhCYXNlIGZyb20gXCIuLi9xdWVyeS9jcmVhdGUtaW5kZXgtYmFzZS5qc1wiXG5pbXBvcnQgVGFibGVDb2x1bW4gZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlSW5kZXggZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtaW5kZXguanNcIlxuY2xhc3MgTm90SW1wbGVtZW50ZWRFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmV4cG9ydCB7Tm90SW1wbGVtZW50ZWRFcnJvcn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VNaWdyYXRpb24ge1xuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL21pZ3JhdGlvbi1leGVjdXRpb24tcGhhc2UuanNcIikuTWlncmF0aW9uRXhlY3V0aW9uUGhhc2UgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfZXhlY3V0aW9uUGhhc2VcblxuICAvKipcbiAgICogRGVjbGFyZXMgd2hlbiB0aGlzIG1pZ3JhdGlvbiBpcyBlbGlnaWJsZSB0byBydW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vbWlncmF0aW9uLWV4ZWN1dGlvbi1waGFzZS5qc1wiKS5NaWdyYXRpb25FeGVjdXRpb25QaGFzZX0gcGhhc2UgLSBFeGVjdXRpb24gcGhhc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBydW5JblBoYXNlKHBoYXNlKSB7XG4gICAgdGhpcy5fZXhlY3V0aW9uUGhhc2UgPSBtaWdyYXRpb25FeGVjdXRpb25QaGFzZShwaGFzZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBkZWNsYXJlZCBleGVjdXRpb24gcGhhc2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9taWdyYXRpb24tZXhlY3V0aW9uLXBoYXNlLmpzXCIpLk1pZ3JhdGlvbkV4ZWN1dGlvblBoYXNlfSAtIERlY2xhcmVkIGV4ZWN1dGlvbiBwaGFzZS5cbiAgICovXG4gIHN0YXRpYyBnZXRFeGVjdXRpb25QaGFzZSgpIHtcbiAgICByZXR1cm4gdGhpcy5fZXhlY3V0aW9uUGhhc2UgfHwgREVGQVVMVF9NSUdSQVRJT05fRVhFQ1VUSU9OX1BIQVNFXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbiBkYXRhYmFzZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRhdGFiYXNlSWRlbnRpZmllcnMgLSBEYXRhYmFzZSBpZGVudGlmaWVycy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIG9uRGF0YWJhc2VzKGRhdGFiYXNlSWRlbnRpZmllcnMpIHtcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXJzID0gZGF0YWJhc2VJZGVudGlmaWVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9IC0gVGhlIGRhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKi9cbiAgc3RhdGljIGdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyID0gXCJkZWZhdWx0XCIsIGRifSkge1xuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhYmFzZSBpZGVudGlmaWVyIGdpdmVuXCIpXG4gICAgaWYgKCFkYikgdGhyb3cgbmV3IEVycm9yKFwiTm8gJ2RiJyBnaXZlblwiKVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMuX2RiID0gZGJcbiAgfVxuXG4gIF9nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGlkZW50aWZpZXIgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZHJpdmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGRyaXZlci5cbiAgICovXG4gIGdldERyaXZlcigpIHsgcmV0dXJuIHRoaXMuX2RiIH1cbiAgY29ubmVjdGlvbigpIHsgcmV0dXJuIHRoaXMuZ2V0RHJpdmVyKCkgfVxuXG4gIGFzeW5jIGNoYW5nZSgpIHtcbiAgICB0aHJvdyBuZXcgTm90SW1wbGVtZW50ZWRFcnJvcihcIidjaGFuZ2UnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgYXN5bmMgdXAoKSB7XG4gICAgdGhyb3cgbmV3IE5vdEltcGxlbWVudGVkRXJyb3IoXCInY2hhbmdlJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIGFzeW5jIGRvd24oKSB7XG4gICAgdGhyb3cgbmV3IE5vdEltcGxlbWVudGVkRXJyb3IoXCInY2hhbmdlJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBleGVjdXRlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZShzcWwpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7QWRkQ29sdW1uQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWRkQ29sdW1uKHRhYmxlTmFtZSwgY29sdW1uTmFtZSwgY29sdW1uVHlwZSwgYXJncykge1xuICAgIGlmICghY29sdW1uVHlwZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1uIHR5cGUgZ2l2ZW5cIilcblxuICAgIGNvbnN0IHRhYmxlQ29sdW1uQXJncyA9IE9iamVjdC5hc3NpZ24oe2lzTmV3Q29sdW1uOiB0cnVlLCB0eXBlOiBjb2x1bW5UeXBlfSwgYXJncylcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRDb2x1bW4oY29sdW1uTmFtZSwgdGFibGVDb2x1bW5BcmdzKVxuXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZW1vdmVDb2x1bW4odGFibGVOYW1lLCBjb2x1bW5OYW1lKSB7XG4gICAgY29uc3QgdGFibGVDb2x1bW5BcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJvcENvbHVtbjogdHJ1ZX0pXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUpXG5cbiAgICB0YWJsZURhdGEuYWRkQ29sdW1uKGNvbHVtbk5hbWUsIHRhYmxlQ29sdW1uQXJncylcblxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRJbmRleEFyZ3NUeXBlIHR5cGUuXG4gICAqIEB0eXBlZGVmIHtvYmplY3R9IEFkZEluZGV4QXJnc1R5cGVcbiAgICogQHByb3BlcnR5IHtib29sZWFufSBbaWZOb3RFeGlzdHNdIC0gU2tpcCBjcmVhdGlvbiBpZiB0aGUgaW5kZXggYWxyZWFkeSBleGlzdHMuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lIHRvIHVzZS5cbiAgICogQHByb3BlcnR5IHtib29sZWFufSBbdW5pcXVlXSAtIFdoZXRoZXIgdGhlIGluZGV4IHNob3VsZCBiZSB1bmlxdWUuXG4gICAqL1xuICAvKipcbiAgICogUnVucyBhZGQgaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWUgb3IgYXJyYXkgb2YgY29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FkZEluZGV4QXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWRkSW5kZXgodGFibGVOYW1lLCBjb2x1bW5zLCBhcmdzKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbHVtbnMgPSB0eXBlb2YgY29sdW1ucyA9PT0gXCJzdHJpbmdcIiA/IFtjb2x1bW5zXSA6IGNvbHVtbnNcbiAgICBjb25zdCBjcmVhdGVJbmRleEFyZ3MgPSBPYmplY3QuYXNzaWduKFxuICAgICAge1xuICAgICAgICBjb2x1bW5zOiBub3JtYWxpemVkQ29sdW1ucyxcbiAgICAgICAgdGFibGVOYW1lXG4gICAgICB9LFxuICAgICAgYXJnc1xuICAgIClcbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5jcmVhdGVJbmRleFNRTHMoY3JlYXRlSW5kZXhBcmdzKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZUluZGV4QXJnc1R5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gUmVtb3ZlSW5kZXhBcmdzVHlwZVxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gRXhwbGljaXQgaW5kZXggbmFtZSB0byByZW1vdmUuXG4gICAqL1xuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSBuYW1lT3JDb2x1bW5zIC0gSW5kZXggbmFtZSBvciBjb2x1bW5zIHdob3NlIGRlZmF1bHQgYWRkSW5kZXggbmFtZSBzaG91bGQgYmUgcmVtb3ZlZC5cbiAgICogQHBhcmFtIHtSZW1vdmVJbmRleEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4KHRhYmxlTmFtZSwgbmFtZU9yQ29sdW1ucywgYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge25hbWUsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCByZW1vdmVJbmRleE5hbWUgPSBuYW1lIHx8IHRoaXMuX3JlbW92ZUluZGV4TmFtZSh0YWJsZU5hbWUsIG5hbWVPckNvbHVtbnMpXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkucmVtb3ZlSW5kZXhTUUxzKHtuYW1lOiByZW1vdmVJbmRleE5hbWUsIHRhYmxlTmFtZX0pXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IG5hbWVPckNvbHVtbnMgLSBJbmRleCBuYW1lIG9yIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGluZGV4IG5hbWUuXG4gICAqL1xuICBfcmVtb3ZlSW5kZXhOYW1lKHRhYmxlTmFtZSwgbmFtZU9yQ29sdW1ucykge1xuICAgIGlmICh0eXBlb2YgbmFtZU9yQ29sdW1ucyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIG5hbWVPckNvbHVtbnNcblxuICAgIGNvbnN0IGNyZWF0ZUluZGV4ID0gbmV3IENyZWF0ZUluZGV4QmFzZSh7XG4gICAgICBjb2x1bW5zOiBuYW1lT3JDb2x1bW5zLFxuICAgICAgZHJpdmVyOiB0aGlzLmdldERyaXZlcigpLFxuICAgICAgdGFibGVOYW1lXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVJbmRleC5nZW5lcmF0ZUluZGV4TmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogQWRkRm9yZWlnbktleUFyZ3NUeXBlIHR5cGUuXG4gICAqIEB0eXBlZGVmIHtvYmplY3R9IEFkZEZvcmVpZ25LZXlBcmdzVHlwZVxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbHVtbk5hbWVdIC0gT3ZlcnJpZGUgdGhlIGRlcml2ZWQgRksgY29sdW1uIG5hbWUgKGRlZmF1bHQ6IGAke3JlZmVyZW5jZV91bmRlcnNjb3JlZH1faWRgKS5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIE92ZXJyaWRlIHRoZSBkZXJpdmVkIGNvbnN0cmFpbnQgbmFtZSAoZGVmYXVsdDogYGZrXyR7dGFibGVOYW1lfV8ke3JlZmVyZW5jZU5hbWV9YCkuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcmVmZXJlbmNlZENvbHVtbk5hbWVdIC0gT3ZlcnJpZGUgdGhlIHJlZmVyZW5jZWQgY29sdW1uIG5hbWUgKGRlZmF1bHQ6IGBpZGApLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW3JlZmVyZW5jZWRUYWJsZU5hbWVdIC0gT3ZlcnJpZGUgdGhlIGRlcml2ZWQgcmVmZXJlbmNlZCB0YWJsZSAoZGVmYXVsdDogcGx1cmFsaXplZCBgcmVmZXJlbmNlTmFtZWApLlxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgdGhlIEZLIGxpdmVzIG9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVmZXJlbmNlTmFtZSAtIFNpbmd1bGFyIHJlZmVyZW5jZSBuYW1lLiBEZWZhdWx0cyBkZXJpdmVcbiAgICogICB0aGUgRksgY29sdW1uIGFzIGAke3JlZmVyZW5jZX1faWRgLCB0aGUgcmVmZXJlbmNlZCB0YWJsZSBieSBwbHVyYWxpemluZ1xuICAgKiAgIHRoZSByZWZlcmVuY2UsIHRoZSByZWZlcmVuY2VkIGNvbHVtbiBhcyBgaWRgLCBhbmQgdGhlIGNvbnN0cmFpbnQgbmFtZVxuICAgKiAgIGFzIGBma18ke3RhYmxlTmFtZX1fJHtyZWZlcmVuY2VOYW1lfWAuIE92ZXJyaWRlIGFueSBvZiB0aG9zZSB2aWEgYGFyZ3NgXG4gICAqICAgd2hlbiB0aGUgc2NoZW1hIGRvZXNuJ3QgZm9sbG93IHRoZSBjb252ZW50aW9uLlxuICAgKiBAcGFyYW0ge0FkZEZvcmVpZ25LZXlBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWRkRm9yZWlnbktleSh0YWJsZU5hbWUsIHJlZmVyZW5jZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjb2x1bW5OYW1lLCBuYW1lLCByZWZlcmVuY2VkQ29sdW1uTmFtZSwgcmVmZXJlbmNlZFRhYmxlTmFtZSwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHJlZmVyZW5jZU5hbWVVbmRlcnNjb3JlID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKHJlZmVyZW5jZU5hbWUpXG4gICAgY29uc3QgcmVzb2x2ZWRSZWZlcmVuY2VkVGFibGVOYW1lID0gcmVmZXJlbmNlZFRhYmxlTmFtZSB8fCBpbmZsZWN0aW9uLnBsdXJhbGl6ZShyZWZlcmVuY2VOYW1lVW5kZXJzY29yZSlcbiAgICBjb25zdCByZXNvbHZlZENvbHVtbk5hbWUgPSBjb2x1bW5OYW1lIHx8IGAke3JlZmVyZW5jZU5hbWVVbmRlcnNjb3JlfV9pZGBcbiAgICBjb25zdCByZXNvbHZlZFJlZmVyZW5jZWRDb2x1bW5OYW1lID0gcmVmZXJlbmNlZENvbHVtbk5hbWUgfHwgXCJpZFwiXG4gICAgY29uc3QgcmVzb2x2ZWROYW1lID0gbmFtZSB8fCBgZmtfJHt0YWJsZU5hbWV9XyR7cmVmZXJlbmNlTmFtZX1gXG5cbiAgICBhd2FpdCB0aGlzLmdldERyaXZlcigpLmFkZEZvcmVpZ25LZXkoXG4gICAgICB0YWJsZU5hbWUsXG4gICAgICByZXNvbHZlZENvbHVtbk5hbWUsXG4gICAgICByZXNvbHZlZFJlZmVyZW5jZWRUYWJsZU5hbWUsXG4gICAgICByZXNvbHZlZFJlZmVyZW5jZWRDb2x1bW5OYW1lLFxuICAgICAge1xuICAgICAgICBpc05ld0ZvcmVpZ25LZXk6IHRydWUsXG4gICAgICAgIG5hbWU6IHJlc29sdmVkTmFtZVxuICAgICAgfVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVGb3JlaWduS2V5QXJnc1R5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gUmVtb3ZlRm9yZWlnbktleUFyZ3NUeXBlXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29sdW1uTmFtZV0gLSBPdmVycmlkZSB0aGUgZGVyaXZlZCBmb3JlaWduLWtleSBjb2x1bW4gbmFtZS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIHRoZSBmb3JlaWduIGtleSBsaXZlcyBvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlZmVyZW5jZU5hbWUgLSBTaW5ndWxhciByZWZlcmVuY2UgbmFtZSB1c2VkIHRvIGRlcml2ZSB0aGUgRksgY29sdW1uLlxuICAgKiBAcGFyYW0ge1JlbW92ZUZvcmVpZ25LZXlBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlRm9yZWlnbktleSh0YWJsZU5hbWUsIHJlZmVyZW5jZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjb2x1bW5OYW1lLCAuLi5yZXN0QXJnc30gPSBhcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgcmVzb2x2ZWRDb2x1bW5OYW1lID0gY29sdW1uTmFtZSB8fCBgJHtpbmZsZWN0aW9uLnVuZGVyc2NvcmUocmVmZXJlbmNlTmFtZSl9X2lkYFxuICAgIGNvbnN0IGRyaXZlciA9IHRoaXMuZ2V0RHJpdmVyKClcbiAgICBsZXQgbWF4aW11bVJlbW92YWxzID0gMFxuICAgIGxldCBwcmV2aW91c01hdGNoaW5nQ291bnQgPSAwXG5cbiAgICBmb3IgKGxldCByZW1vdmFsQXR0ZW1wdCA9IDA7IDsgcmVtb3ZhbEF0dGVtcHQrKykge1xuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkcml2ZXIuZ2V0VGFibGVCeU5hbWUodGFibGVOYW1lKVxuXG4gICAgICBpZiAoIXRhYmxlKSB0aHJvdyBuZXcgRXJyb3IoYFRhYmxlICR7dGFibGVOYW1lfSBkb2VzIG5vdCBleGlzdGApXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlzID0gYXdhaXQgdGFibGUuZ2V0Rm9yZWlnbktleXMoKVxuICAgICAgY29uc3QgbWF0Y2hpbmdGb3JlaWduS2V5cyA9IGZvcmVpZ25LZXlzLmZpbHRlcigoZm9yZWlnbktleSkgPT4gZm9yZWlnbktleS5nZXRDb2x1bW5OYW1lKCkgPT0gcmVzb2x2ZWRDb2x1bW5OYW1lKVxuXG4gICAgICBpZiAobWF0Y2hpbmdGb3JlaWduS2V5cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKHJlbW92YWxBdHRlbXB0ID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGZvcmVpZ24ga2V5IG9uICR7dGFibGVOYW1lfS4ke3Jlc29sdmVkQ29sdW1uTmFtZX1gKVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAocmVtb3ZhbEF0dGVtcHQgPT09IDApIHtcbiAgICAgICAgbWF4aW11bVJlbW92YWxzID0gbWF0Y2hpbmdGb3JlaWduS2V5cy5sZW5ndGhcbiAgICAgIH0gZWxzZSBpZiAobWF0Y2hpbmdGb3JlaWduS2V5cy5sZW5ndGggPj0gcHJldmlvdXNNYXRjaGluZ0NvdW50KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRm9yZWlnbiBrZXkgcmVtb3ZhbCBkaWQgbm90IHJlZHVjZSBtYXRjaGVzIG9uICR7dGFibGVOYW1lfS4ke3Jlc29sdmVkQ29sdW1uTmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBpZiAocmVtb3ZhbEF0dGVtcHQgPj0gbWF4aW11bVJlbW92YWxzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRm9yZWlnbiBrZXkgcmVtb3ZhbCBleGNlZWRlZCBleHBlY3RlZCBtYXRjaGVzIG9uICR7dGFibGVOYW1lfS4ke3Jlc29sdmVkQ29sdW1uTmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBwcmV2aW91c01hdGNoaW5nQ291bnQgPSBtYXRjaGluZ0ZvcmVpZ25LZXlzLmxlbmd0aFxuICAgICAgYXdhaXQgZHJpdmVyLnJlbW92ZUZvcmVpZ25LZXkodGFibGVOYW1lLCBtYXRjaGluZ0ZvcmVpZ25LZXlzWzBdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVmZXJlbmNlTmFtZSAtIFJlZmVyZW5jZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmZvcmVpZ25LZXldIC0gV2hldGhlciBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5udWxsXSAtIFdoZXRoZXIgbnVsbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy50eXBlXSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy51bmlxdWVdIC0gV2hldGhlciB1bmlxdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZGRSZWZlcmVuY2UodGFibGVOYW1lLCByZWZlcmVuY2VOYW1lLCBhcmdzKSB7XG4gICAgY29uc3Qge2ZvcmVpZ25LZXksIG51bGw6IG51bGxhYmxlLCB0eXBlLCB1bmlxdWUsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gYCR7aW5mbGVjdGlvbi51bmRlcnNjb3JlKHJlZmVyZW5jZU5hbWUpfV9pZGBcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCBjb2x1bW5UeXBlID0gdHlwZSB8fCBcImludGVnZXJcIlxuICAgIGNvbnN0IGNvbHVtbkFyZ3MgPSBudWxsYWJsZSAhPT0gdW5kZWZpbmVkID8ge251bGw6IG51bGxhYmxlfSA6IHVuZGVmaW5lZFxuXG4gICAgYXdhaXQgdGhpcy5hZGRDb2x1bW4odGFibGVOYW1lLCBjb2x1bW5OYW1lLCBjb2x1bW5UeXBlLCBjb2x1bW5BcmdzKVxuICAgIGF3YWl0IHRoaXMuYWRkSW5kZXgodGFibGVOYW1lLCBbY29sdW1uTmFtZV0sIHt1bmlxdWU6IHVuaXF1ZX0pXG5cbiAgICBpZiAoZm9yZWlnbktleSkge1xuICAgICAgYXdhaXQgdGhpcy5hZGRGb3JlaWduS2V5KHRhYmxlTmFtZSwgcmVmZXJlbmNlTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlUmVmZXJlbmNlQXJnc1R5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gUmVtb3ZlUmVmZXJlbmNlQXJnc1R5cGVcbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb2x1bW5OYW1lXSAtIE92ZXJyaWRlIHRoZSBkZXJpdmVkIHJlZmVyZW5jZSBjb2x1bW4gbmFtZS5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtpbmRleE5hbWVdIC0gRXhwbGljaXQgZ2VuZXJhdGVkIGluZGV4IG5hbWUgdG8gcmVtb3ZlLlxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWZlcmVuY2VOYW1lIC0gUmVmZXJlbmNlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVtb3ZlUmVmZXJlbmNlQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbmFsIG92ZXJyaWRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZVJlZmVyZW5jZSh0YWJsZU5hbWUsIHJlZmVyZW5jZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjb2x1bW5OYW1lLCBpbmRleE5hbWUsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCByZXNvbHZlZENvbHVtbk5hbWUgPSBjb2x1bW5OYW1lIHx8IGAke2luZmxlY3Rpb24udW5kZXJzY29yZShyZWZlcmVuY2VOYW1lKX1faWRgXG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5nZXREcml2ZXIoKVxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZHJpdmVyLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSlcblxuICAgIGlmICghdGFibGUpIHRocm93IG5ldyBFcnJvcihgVGFibGUgJHt0YWJsZU5hbWV9IGRvZXMgbm90IGV4aXN0YClcblxuICAgIGNvbnN0IGZvcmVpZ25LZXlzID0gYXdhaXQgdGFibGUuZ2V0Rm9yZWlnbktleXMoKVxuXG4gICAgZm9yIChjb25zdCBmb3JlaWduS2V5IG9mIGZvcmVpZ25LZXlzKSB7XG4gICAgICBpZiAoZm9yZWlnbktleS5nZXRDb2x1bW5OYW1lKCkgIT0gcmVzb2x2ZWRDb2x1bW5OYW1lKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBkcml2ZXIucmVtb3ZlRm9yZWlnbktleSh0YWJsZU5hbWUsIGZvcmVpZ25LZXkpXG4gICAgfVxuXG4gICAgY29uc3QgZXhwZWN0ZWRJbmRleE5hbWUgPSBpbmRleE5hbWUgfHwgdGhpcy5fcmVtb3ZlSW5kZXhOYW1lKHRhYmxlTmFtZSwgW3Jlc29sdmVkQ29sdW1uTmFtZV0pXG4gICAgY29uc3QgaW5kZXhlcyA9IGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKVxuICAgIGNvbnN0IGdlbmVyYXRlZEluZGV4ID0gaW5kZXhlcy5maW5kKChpbmRleCkgPT4ge1xuICAgICAgY29uc3QgaW5kZXhDb2x1bW5OYW1lcyA9IGluZGV4LmdldENvbHVtbk5hbWVzKClcblxuICAgICAgcmV0dXJuICFpbmRleC5pc1ByaW1hcnlLZXkoKSAmJlxuICAgICAgICBpbmRleC5nZXROYW1lKCkgPT0gZXhwZWN0ZWRJbmRleE5hbWUgJiZcbiAgICAgICAgaW5kZXhDb2x1bW5OYW1lcy5sZW5ndGggPT0gMSAmJlxuICAgICAgICBpbmRleENvbHVtbk5hbWVzWzBdID09IHJlc29sdmVkQ29sdW1uTmFtZVxuICAgIH0pXG5cbiAgICBpZiAoZ2VuZXJhdGVkSW5kZXgpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlSW5kZXgodGFibGVOYW1lLCBnZW5lcmF0ZWRJbmRleC5nZXROYW1lKCkpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5yZW1vdmVDb2x1bW4odGFibGVOYW1lLCByZXNvbHZlZENvbHVtbk5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFuZ2UgY29sdW1uIG51bGwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG51bGxhYmxlIC0gV2hldGhlciBudWxsYWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNoYW5nZUNvbHVtbk51bGwodGFibGVOYW1lLCBjb2x1bW5OYW1lLCBudWxsYWJsZSkge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5nZXRUYWJsZUJ5TmFtZSh0YWJsZU5hbWUpXG5cbiAgICBpZiAoIXRhYmxlKSB0aHJvdyBuZXcgRXJyb3IoYFRhYmxlICR7dGFibGVOYW1lfSBkb2VzIG5vdCBleGlzdGApXG5cbiAgICBjb25zdCBjb2x1bW4gPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmICghY29sdW1uKSB0aHJvdyBuZXcgRXJyb3IoYENvbHVtbiAke2NvbHVtbk5hbWV9IGRvZXMgbm90IGV4aXN0IGluIHRhYmxlICR7dGFibGVOYW1lfWApXG5cbiAgICBhd2FpdCBjb2x1bW4uY2hhbmdlTnVsbGFibGUobnVsbGFibGUpXG4gIH1cblxuICAvKipcbiAgICogTWlncmF0ZXMgbGVnYWN5IHRpbWV6b25lLWxlc3MgbG9jYWwgZGF0ZXRpbWUgcm93cyBpbnRvIFVUQyBkYXRldGltZSBzdG9yYWdlLlxuICAgKiBOZXcgU1FMaXRlIFVUQyByb3dzIGluY2x1ZGUgYSB0aW1lem9uZSBzdWZmaXggYW5kIGFyZSBza2lwcGVkLlxuICAgKiBAcGFyYW0ge0xlZ2FjeUxvY2FsRGF0ZVRpbWVzTWlncmF0aW9uQXJnc1R5cGV9IFthcmdzXSAtIE1pZ3JhdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbWlncmF0ZUxlZ2FjeUxvY2FsRGF0ZVRpbWVzVG9VdGNTdG9yYWdlKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjb2x1bW5zQnlUYWJsZSwgbGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzLCB0YWJsZXMsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCB0YWJsZU5hbWVzID0gYXdhaXQgdGhpcy5fbGVnYWN5TG9jYWxEYXRlVGltZXNUYWJsZU5hbWVzKHRhYmxlcylcblxuICAgIGZvciAoY29uc3QgdGFibGVOYW1lIG9mIHRhYmxlTmFtZXMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX21pZ3JhdGVMZWdhY3lMb2NhbERhdGVUaW1lc1RhYmxlKHtcbiAgICAgICAgY29sdW1uc0J5VGFibGUsXG4gICAgICAgIGxlZ2FjeUxvY2FsT2Zmc2V0TWludXRlcyxcbiAgICAgICAgdGFibGVOYW1lXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0YWJsZSBuYW1lcyBmb3IgYSBsZWdhY3kgbG9jYWwgZGF0ZXRpbWUgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSB0YWJsZXMgLSBFeHBsaWNpdCB0YWJsZSBuYW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFRhYmxlIG5hbWVzLlxuICAgKi9cbiAgYXN5bmMgX2xlZ2FjeUxvY2FsRGF0ZVRpbWVzVGFibGVOYW1lcyh0YWJsZXMpIHtcbiAgICBpZiAodGFibGVzKSByZXR1cm4gdGFibGVzXG5cbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuZ2V0VGFibGVzKCkpXG4gICAgICAubWFwKCh0YWJsZSkgPT4gdGFibGUuZ2V0TmFtZSgpKVxuICAgICAgLmZpbHRlcigodGFibGVOYW1lKSA9PiB0YWJsZU5hbWUgIT0gXCJzY2hlbWFfbWlncmF0aW9uc1wiICYmICF0YWJsZU5hbWUuc3RhcnRzV2l0aChcInNxbGl0ZV9cIikpXG4gIH1cblxuICAvKipcbiAgICogTWlncmF0ZXMgb25lIHRhYmxlJ3MgbGVnYWN5IGxvY2FsIGRhdGV0aW1lIHZhbHVlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5zQnlUYWJsZSAtIEV4cGxpY2l0IGNvbHVtbnMga2V5ZWQgYnkgdGFibGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBhcmdzLmxlZ2FjeUxvY2FsT2Zmc2V0TWludXRlcyAtIFVUQy1taW51cy1sb2NhbCBvZmZzZXQgaW4gbWludXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9taWdyYXRlTGVnYWN5TG9jYWxEYXRlVGltZXNUYWJsZSh7Y29sdW1uc0J5VGFibGUsIGxlZ2FjeUxvY2FsT2Zmc2V0TWludXRlcywgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IGRyaXZlciA9IHRoaXMuZ2V0RHJpdmVyKClcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRyaXZlci5nZXRUYWJsZUJ5TmFtZU9yRmFpbCh0YWJsZU5hbWUpXG4gICAgY29uc3QgY29sdW1ucyA9IGF3YWl0IHRoaXMuX2xlZ2FjeUxvY2FsRGF0ZVRpbWVzQ29sdW1ucyh7Y29sdW1uc0J5VGFibGUsIHRhYmxlfSlcblxuICAgIGlmIChjb2x1bW5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gYXdhaXQgdGhpcy5fbGVnYWN5TG9jYWxEYXRlVGltZXNQcmltYXJ5S2V5KHRhYmxlKVxuICAgIGNvbnN0IHNlbGVjdGVkQ29sdW1ucyA9IFtwcmltYXJ5S2V5Q29sdW1uLCAuLi5jb2x1bW5zXVxuICAgIGNvbnN0IHNlbGVjdFNxbCA9IHNlbGVjdGVkQ29sdW1uc1xuICAgICAgLm1hcCgoY29sdW1uTmFtZSkgPT4gZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpKVxuICAgICAgLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkcml2ZXIucXVlcnkoYFNFTEVDVCAke3NlbGVjdFNxbH0gRlJPTSAke2RyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9YClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBjb2x1bW5zKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gcm93W2NvbHVtbk5hbWVdXG4gICAgICAgIGNvbnN0IGNvbnZlcnRlZFZhbHVlID0gY29udmVydExlZ2FjeURhdGVWYWx1ZVRvVXRjU3RvcmFnZSh2YWx1ZSwge1xuICAgICAgICAgIGRhdGFiYXNlVHlwZTogZHJpdmVyLmdldFR5cGUoKSxcbiAgICAgICAgICBsZWdhY3lMb2NhbE9mZnNldE1pbnV0ZXNcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoY29udmVydGVkVmFsdWUgPT09IHZhbHVlKSBjb250aW51ZVxuXG4gICAgICAgIGF3YWl0IGRyaXZlci5xdWVyeShgXG4gICAgICAgICAgVVBEQVRFICR7ZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX1cbiAgICAgICAgICBTRVQgJHtkcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9ID0gJHtkcml2ZXIucXVvdGUoY29udmVydGVkVmFsdWUpfVxuICAgICAgICAgIFdIRVJFICR7ZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXlDb2x1bW4pfSA9ICR7ZHJpdmVyLnF1b3RlKHJvd1twcmltYXJ5S2V5Q29sdW1uXSl9XG4gICAgICAgIGApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGRhdGUtbGlrZSBjb2x1bW5zIGZvciBvbmUgdGFibGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uc0J5VGFibGUgLSBFeHBsaWNpdCBjb2x1bW5zIGtleWVkIGJ5IHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhYmxlIC0gVGFibGUgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBEYXRlLWxpa2UgY29sdW1uIG5hbWVzLlxuICAgKi9cbiAgYXN5bmMgX2xlZ2FjeUxvY2FsRGF0ZVRpbWVzQ29sdW1ucyh7Y29sdW1uc0J5VGFibGUsIHRhYmxlfSkge1xuICAgIGNvbnN0IGV4cGxpY2l0Q29sdW1ucyA9IGNvbHVtbnNCeVRhYmxlPy5bdGFibGUuZ2V0TmFtZSgpXVxuXG4gICAgaWYgKGV4cGxpY2l0Q29sdW1ucykgcmV0dXJuIGV4cGxpY2l0Q29sdW1uc1xuXG4gICAgcmV0dXJuIChhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKCkpXG4gICAgICAuZmlsdGVyKChjb2x1bW4pID0+IHRoaXMuX2xlZ2FjeUxvY2FsRGF0ZVRpbWVzQ29sdW1uSXNEYXRlTGlrZShjb2x1bW4pKVxuICAgICAgLm1hcCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgY29sdW1uIHNob3VsZCBiZSBpbmNsdWRlZCBieSBkZWZhdWx0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdH0gY29sdW1uIC0gQ29sdW1uIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb2x1bW4gaXMgZGF0ZS1saWtlLlxuICAgKi9cbiAgX2xlZ2FjeUxvY2FsRGF0ZVRpbWVzQ29sdW1uSXNEYXRlTGlrZShjb2x1bW4pIHtcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gY29sdW1uLmdldFR5cGUoKS50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gY29sdW1uVHlwZS5pbmNsdWRlcyhcImRhdGVcIikgfHwgY29sdW1uVHlwZS5pbmNsdWRlcyhcInRpbWVzdGFtcFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzaW5nbGUgcHJpbWFyeSBrZXkgY29sdW1uIGZvciByb3cgdXBkYXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gdGFibGUgLSBUYWJsZSBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBQcmltYXJ5IGtleSBjb2x1bW4gbmFtZS5cbiAgICovXG4gIGFzeW5jIF9sZWdhY3lMb2NhbERhdGVUaW1lc1ByaW1hcnlLZXkodGFibGUpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1ucyA9IChhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKCkpLmZpbHRlcigoY29sdW1uKSA9PiBjb2x1bW4uZ2V0UHJpbWFyeUtleSgpKVxuXG4gICAgaWYgKHByaW1hcnlLZXlDb2x1bW5zLmxlbmd0aCAhPSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGV4YWN0bHkgb25lIHByaW1hcnkga2V5IG9uICR7dGFibGUuZ2V0TmFtZSgpfSBidXQgZm91bmQgJHtwcmltYXJ5S2V5Q29sdW1ucy5sZW5ndGh9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcHJpbWFyeUtleUNvbHVtbnNbMF0uZ2V0TmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb2x1bW4gZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIGNvbHVtbiBleGlzdHMuXG4gICAqL1xuICBhc3luYyBjb2x1bW5FeGlzdHModGFibGVOYW1lLCBjb2x1bW5OYW1lKSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSlcblxuICAgIGlmICh0YWJsZSkge1xuICAgICAgY29uc3QgY29sdW1uID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICAgIGlmIChjb2x1bW4pIHtcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQm9vbGVhbihmYWxzZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhbiBpbmRleCB3aXRoIHRoZSBnaXZlbiBuYW1lIGV4aXN0cyBvbiBhIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGluZGV4TmFtZSAtIEluZGV4IG5hbWUgdG8gbG9vayBmb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGluZGV4IGV4aXN0cyBvbiB0aGUgdGFibGUuXG4gICAqL1xuICBhc3luYyBpbmRleEV4aXN0cyh0YWJsZU5hbWUsIGluZGV4TmFtZSkge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5nZXRUYWJsZUJ5TmFtZSh0YWJsZU5hbWUsIHt0aHJvd0Vycm9yOiBmYWxzZX0pXG5cbiAgICBpZiAodGFibGUpIHtcbiAgICAgIGZvciAoY29uc3QgaW5kZXggb2YgYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKSB7XG4gICAgICAgIGlmIChpbmRleC5nZXROYW1lKCkgPT0gaW5kZXhOYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdXAgdGhlIGRhdGFiYXNlIHNjaGVtYSBmb3IgYSBnYXAtbGVzcyBwb3NpdGlvbmFsIGxpc3QuIEFkZHMgdGhlXG4gICAqIHBvc2l0aW9uIGNvbHVtbiAoSU5UIE5PVCBOVUxMKSBpZiBhYnNlbnQgYW5kIGNyZWF0ZXMgYSBVTklRVUUgaW5kZXggb25cbiAgICogKHNjb3BlLCBwb3NpdGlvbikuIFRoaXMgaXMgdGhlIHNjaGVtYS1zaWRlIGNvdW50ZXJwYXJ0IG9mXG4gICAqIGBNb2RlbC5hY3RzQXNMaXN0KClgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBvc2l0aW9uQ29sdW1uIC0gQ29sdW1uIG5hbWUgZm9yIHRoZSBwb3NpdGlvbiAoZS5nLiBcInJvd19udW1iZXJcIikuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMuc2NvcGUgLSBDb2x1bW4gbmFtZSBmb3IgdGhlIHNjb3BlIChlLmcuIFwiYm9hcmRfY29sdW1uX2lkXCIpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGFkZEFjdHNBc0xpc3QodGFibGVOYW1lLCBwb3NpdGlvbkNvbHVtbiwge3Njb3BlfSkge1xuICAgIGlmICghKGF3YWl0IHRoaXMuY29sdW1uRXhpc3RzKHRhYmxlTmFtZSwgcG9zaXRpb25Db2x1bW4pKSkge1xuICAgICAgYXdhaXQgdGhpcy5hZGRDb2x1bW4odGFibGVOYW1lLCBwb3NpdGlvbkNvbHVtbiwgXCJpbnRlZ2VyXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuY2hhbmdlQ29sdW1uTnVsbCh0YWJsZU5hbWUsIHBvc2l0aW9uQ29sdW1uLCBmYWxzZSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFkZEluZGV4KHRhYmxlTmFtZSwgW3Njb3BlLCBwb3NpdGlvbkNvbHVtbl0sIHt1bmlxdWU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0YWJsZSB3aXRoIGRlZmF1bHQgb3B0aW9ucy5cbiAgICogQG92ZXJsb2FkXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0NyZWF0ZVRhYmxlQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0YWJsZSB3aXRoIGV4cGxpY2l0IG9wdGlvbnMuXG4gICAqIEBvdmVybG9hZFxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtDcmVhdGVUYWJsZUFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Q3JlYXRlVGFibGVDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0NyZWF0ZVRhYmxlQXJnc1R5cGUgfCBDcmVhdGVUYWJsZUNhbGxiYWNrVHlwZX0gYXJnMSAtIEFyZzEuXG4gICAqIEBwYXJhbSB7Q3JlYXRlVGFibGVDYWxsYmFja1R5cGUgfCB1bmRlZmluZWR9IFthcmcyXSAtIEFyZzIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZSh0YWJsZU5hbWUsIGFyZzEsIGFyZzIpIHtcbiAgICBsZXQgYXJnc1xuICAgIGxldCBjYWxsYmFja1xuXG4gICAgaWYgKHR5cGVvZiBhcmcxID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXJncyA9IHt9XG4gICAgICBjYWxsYmFjayA9IGFyZzFcbiAgICB9IGVsc2Uge1xuICAgICAgYXJncyA9IGFyZzFcbiAgICAgIGNhbGxiYWNrID0gYXJnMlxuICAgIH1cblxuICAgIGNvbnN0IHtpZCA9IHt9LCBpZk5vdEV4aXN0cyA9IGZhbHNlLCAuLi5yZXN0QXJnc30gPSBhcmdzXG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5nZXREcml2ZXIoKVxuICAgIGNvbnN0IGRlZmF1bHRQcmltYXJ5S2V5VHlwZSA9IGRyaXZlci5wcmltYXJ5S2V5VHlwZSgpXG4gICAgbGV0IGlkRGVmYXVsdCwgaWRUeXBlLCByZXN0QXJnc0lkXG5cbiAgICBpZiAoaWQgIT09IGZhbHNlKSB7XG4gICAgICAoe2RlZmF1bHQ6IGlkRGVmYXVsdCwgdHlwZTogaWRUeXBlLCAuLi5yZXN0QXJnc0lkfSA9IGlkKVxuXG4gICAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzSWQpXG4gICAgfVxuXG4gICAgaWYgKCFpZFR5cGUpIHtcbiAgICAgIGlkVHlwZSA9IGRlZmF1bHRQcmltYXJ5S2V5VHlwZVxuICAgIH1cbiAgICBjb25zdCBkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEID0gZHJpdmVyLnN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEPy4oKVxuICAgIGNvbnN0IGxvd2VySWRUeXBlID0gaWRUeXBlPy50b0xvd2VyQ2FzZSgpXG4gICAgY29uc3QgaXNVVUlEUHJpbWFyeUtleSA9IGxvd2VySWRUeXBlID09IFwidXVpZFwiXG4gICAgY29uc3QgbnVtZXJpY0F1dG9JbmNyZW1lbnRUeXBlcyA9IFtcImludFwiLCBcImludGVnZXJcIiwgXCJiaWdpbnRcIiwgXCJzbWFsbGludFwiLCBcInRpbnlpbnRcIl1cbiAgICBsZXQgaWRBdXRvSW5jcmVtZW50ID0gbnVtZXJpY0F1dG9JbmNyZW1lbnRUeXBlcy5pbmNsdWRlcyhsb3dlcklkVHlwZSB8fCBcIlwiKVxuXG4gICAgaWYgKGlzVVVJRFByaW1hcnlLZXkpIHtcbiAgICAgIGlkQXV0b0luY3JlbWVudCA9IGZhbHNlXG5cbiAgICAgIGlmIChkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEKSB7XG4gICAgICAgIGlmIChpZERlZmF1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlkRGVmYXVsdCA9ICgpID0+IFwiVVVJRCgpXCJcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpZERlZmF1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBMZXQgYXBwbGljYXRpb24gY29kZSBhc3NpZ24gVVVJRHMgKHNlZSBEYXRhYmFzZVJlY29yZC5pbnNlcnQpIHdoZW4gdGhlIGRyaXZlciBjYW4ndCBkbyBpdC5cbiAgICAgICAgaWREZWZhdWx0ID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgICAvLyBJZiBkcml2ZXIgZG9lc24ndCBzdXBwb3J0IFVVSUQoKSBidXQgdGhlIGNhbGxlciBleHBsaWNpdGx5IHNldCBhIGRlZmF1bHQsIHJlc3BlY3QgaXQuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUsIHtpZk5vdEV4aXN0cywgcHJpbWFyeUtleVR5cGU6IGRlZmF1bHRQcmltYXJ5S2V5VHlwZX0pXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCEoaWRUeXBlIGluIHRhYmxlRGF0YSkpIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJpbWFyeSBrZXkgdHlwZTogJHtpZFR5cGV9YClcblxuICAgIGlmIChpZCAhPT0gZmFsc2UpIHtcbiAgICAgIHRhYmxlRGF0YS5hZGRDb2x1bW4oXCJpZFwiLCB7YXV0b0luY3JlbWVudDogaWRBdXRvSW5jcmVtZW50LCBkZWZhdWx0OiBpZERlZmF1bHQsIG51bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlLCB0eXBlOiBpZFR5cGV9KVxuICAgIH1cblxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2sodGFibGVEYXRhKVxuICAgIH1cblxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkcml2ZXIuY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5fZGIucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGFuZ2VUYWJsZUFyZ3NUeXBlIHR5cGUuXG4gICAqIEB0eXBlZGVmIHtvYmplY3R9IENoYW5nZVRhYmxlQXJnc1R5cGVcbiAgICogQHByb3BlcnR5IHtib29sZWFufSBbYnVsa10gLSBDb21iaW5lIGNvbXBhdGlibGUgY29udGlndW91cyBEREwgaW50byBzaW5nbGVcbiAgICogICBBTFRFUiBUQUJMRSBzdGF0ZW1lbnRzIG9uIGRyaXZlcnMgdGhhdCBzdXBwb3J0IGJ1bGsgYWx0ZXJzIChNeVNRTC9NYXJpYURCXG4gICAqICAgYW5kIFBvc3RncmVTUUwpLiBgYnVsa2AgY29udHJvbHMgRERMIGdyb3VwaW5nIG9ubHksIG5vdCB0cmFuc2FjdGlvbmFsXG4gICAqICAgYXRvbWljaXR5OyB1bmNoYW5nZWQgZHJpdmVycyBleGVjdXRlIHRoZSByZWNvcmRlZCBjb21tYW5kcyBzZXF1ZW50aWFsbHkuXG4gICAqL1xuXG4gIC8qKlxuICAgKiBDaGFuZ2VUYWJsZUNhbGxiYWNrVHlwZSB0eXBlLlxuICAgKiBAdHlwZWRlZiB7KHRhYmxlOiBpbXBvcnQoXCIuL2NoYW5nZS10YWJsZS5qc1wiKS5kZWZhdWx0KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gQ2hhbmdlVGFibGVDYWxsYmFja1R5cGVcbiAgICovXG5cbiAgLyoqXG4gICAqIENoYW5nZXMgYSB0YWJsZSB1c2luZyBhIFJhaWxzLXN0eWxlIHRhYmxlLXNjb3BlZCByZWNvcmRlci5cbiAgICogQG92ZXJsb2FkXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0NoYW5nZVRhYmxlQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgLyoqXG4gICAqIENoYW5nZXMgYSB0YWJsZSB3aXRoIGV4cGxpY2l0IG9wdGlvbnMuXG4gICAqIEBvdmVybG9hZFxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtDaGFuZ2VUYWJsZUFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Q2hhbmdlVGFibGVDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogUnVucyBjaGFuZ2UgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0NoYW5nZVRhYmxlQXJnc1R5cGUgfCBDaGFuZ2VUYWJsZUNhbGxiYWNrVHlwZX0gYXJnMSAtIEFyZzEuXG4gICAqIEBwYXJhbSB7Q2hhbmdlVGFibGVDYWxsYmFja1R5cGUgfCB1bmRlZmluZWR9IFthcmcyXSAtIEFyZzIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjaGFuZ2VUYWJsZSh0YWJsZU5hbWUsIGFyZzEsIGFyZzIpIHtcbiAgICBsZXQgYXJncyA9IC8qKiBAdHlwZSB7Q2hhbmdlVGFibGVBcmdzVHlwZX0gKi8gKHt9KVxuICAgIGxldCBjYWxsYmFja1xuXG4gICAgaWYgKHR5cGVvZiBhcmcxID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY2FsbGJhY2sgPSBhcmcxXG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZ3MgPSBhcmcxIHx8IHt9XG4gICAgICBjYWxsYmFjayA9IGFyZzJcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY2FsbGJhY2sgZ2l2ZW5cIilcblxuICAgIGNvbnN0IHtidWxrID0gZmFsc2UsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBDaGFuZ2VUYWJsZSh7dGFibGVOYW1lfSlcblxuICAgIGF3YWl0IGNhbGxiYWNrKHRhYmxlKVxuXG4gICAgYXdhaXQgdGhpcy5fZXhlY3V0ZUNoYW5nZVRhYmxlT3BlcmF0aW9ucyh0YWJsZU5hbWUsIHRhYmxlLmdldE9wZXJhdGlvbnMoKSwge2J1bGt9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIHJlY29yZGVkIGNoYW5nZVRhYmxlIG9wZXJhdGlvbnMuIFdpdGggYGJ1bGtgIGVuYWJsZWQgb24gYVxuICAgKiBzdXBwb3J0aW5nIGRyaXZlciwgY29tcGF0aWJsZSBjb250aWd1b3VzIGNvbHVtbiBvcGVyYXRpb25zIGFjY3VtdWxhdGUgaW50b1xuICAgKiBhIHNpbmdsZSBUYWJsZURhdGEgZmx1c2hlZCB0aHJvdWdoIGBhbHRlclRhYmxlU1FMc2A7IGluY29tcGF0aWJsZSBjb21tYW5kc1xuICAgKiBmbHVzaCB0aGUgYmF0Y2ggZmlyc3QgYW5kIHJ1biB0aHJvdWdoIHRoZSBleGlzdGluZyBtaWdyYXRpb24gaGVscGVycy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jaGFuZ2UtdGFibGUuanNcIikuQ2hhbmdlVGFibGVPcGVyYXRpb25UeXBlW119IG9wZXJhdGlvbnMgLSBSZWNvcmRlZCBvcGVyYXRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYnVsayAtIFdoZXRoZXIgdG8gZW5hYmxlIGJ1bGsgY29tbWFuZCBncm91cGluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9leGVjdXRlQ2hhbmdlVGFibGVPcGVyYXRpb25zKHRhYmxlTmFtZSwgb3BlcmF0aW9ucywge2J1bGt9KSB7XG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5nZXREcml2ZXIoKVxuICAgIGNvbnN0IGJ1bGtTdXBwb3J0ZWQgPSBidWxrICYmIGRyaXZlci5zdXBwb3J0c0J1bGtBbHRlcigpXG5cbiAgICBpZiAoIWJ1bGtTdXBwb3J0ZWQpIHtcbiAgICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZXhlY3V0ZUNoYW5nZVRhYmxlT3BlcmF0aW9uKHRhYmxlTmFtZSwgb3BlcmF0aW9uKVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBsZXQgYmF0Y2ggPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIGNvbnN0IGZsdXNoQmF0Y2ggPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoYmF0Y2guZ2V0Q29sdW1ucygpLmxlbmd0aCA9PSAwICYmIGJhdGNoLmdldEluZGV4ZXMoKS5sZW5ndGggPT0gMCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkcml2ZXIuYWx0ZXJUYWJsZVNRTHMoYmF0Y2gpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgYXdhaXQgZHJpdmVyLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgYmF0Y2ggPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBvcGVyYXRpb25zKSB7XG4gICAgICBzd2l0Y2ggKG9wZXJhdGlvbi50eXBlKSB7XG4gICAgICAgIGNhc2UgXCJhZGRDb2x1bW5cIjoge1xuICAgICAgICAgIGlmICghb3BlcmF0aW9uLmNvbHVtblR5cGUpIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbHVtbiB0eXBlIGdpdmVuXCIpXG5cbiAgICAgICAgICAvLyBGbHVzaCBhbiBhbHJlYWR5LXJlY29yZGVkIGluZGV4IGJhdGNoIGZpcnN0IHNvIHRoZSBlbWl0dGVkIFNRTCBrZWVwc1xuICAgICAgICAgIC8vIHRoZSByZWNvcmRlZCBkZWNsYXJhdGlvbiBvcmRlciAoaW5kZXggYmVmb3JlIGNvbHVtbikuXG4gICAgICAgICAgaWYgKGJhdGNoLmdldEluZGV4ZXMoKS5sZW5ndGggPiAwKSBhd2FpdCBmbHVzaEJhdGNoKClcblxuICAgICAgICAgIGJhdGNoLmFkZENvbHVtbihuZXcgVGFibGVDb2x1bW4ob3BlcmF0aW9uLmNvbHVtbk5hbWUsIE9iamVjdC5hc3NpZ24oe2lzTmV3Q29sdW1uOiB0cnVlLCB0eXBlOiBvcGVyYXRpb24uY29sdW1uVHlwZX0sIG9wZXJhdGlvbi5hcmdzKSkpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwicmVtb3ZlQ29sdW1uXCI6XG4gICAgICAgICAgLy8gRmx1c2ggYW4gYWxyZWFkeS1yZWNvcmRlZCBpbmRleCBiYXRjaCBmaXJzdCBzbyB0aGUgZW1pdHRlZCBTUUwga2VlcHNcbiAgICAgICAgICAvLyB0aGUgcmVjb3JkZWQgZGVjbGFyYXRpb24gb3JkZXIgKGluZGV4IGJlZm9yZSBjb2x1bW4pLlxuICAgICAgICAgIGlmIChiYXRjaC5nZXRJbmRleGVzKCkubGVuZ3RoID4gMCkgYXdhaXQgZmx1c2hCYXRjaCgpXG5cbiAgICAgICAgICBiYXRjaC5hZGRDb2x1bW4obmV3IFRhYmxlQ29sdW1uKG9wZXJhdGlvbi5jb2x1bW5OYW1lLCB7ZHJvcENvbHVtbjogdHJ1ZX0pKVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgXCJhZGRJbmRleFwiOlxuICAgICAgICAgIC8vIERyaXZlcnMgd2l0aG91dCBgc3VwcG9ydHNCdWxrQWx0ZXJJbmRleGVzYCAoUG9zdGdyZVNRTCkga2VlcCBpbmRleGVzXG4gICAgICAgICAgLy8gc3RhbmRhbG9uZSBiZWNhdXNlIHRoZWlyIEFMVEVSIFRBQkxFIGRvZXMgbm90IGNhcnJ5IENSRUFURSBJTkRFWFxuICAgICAgICAgIC8vIGNsYXVzZXMuIEFuIGlmTm90RXhpc3RzIGluZGV4IGlzIG5ldmVyIGNvbWJpbmVkIGJlY2F1c2UgdGhlIGNvbWJpbmVkXG4gICAgICAgICAgLy8gYnVsayBmb3JtIGNhbm5vdCBleHByZXNzIHRoYXQgZ3VhcmQuXG4gICAgICAgICAgaWYgKCFkcml2ZXIuc3VwcG9ydHNCdWxrQWx0ZXJJbmRleGVzKCkgfHwgb3BlcmF0aW9uLmFyZ3M/LmlmTm90RXhpc3RzKSB7XG4gICAgICAgICAgICBhd2FpdCBmbHVzaEJhdGNoKClcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX2V4ZWN1dGVDaGFuZ2VUYWJsZU9wZXJhdGlvbih0YWJsZU5hbWUsIG9wZXJhdGlvbilcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYmF0Y2guYWRkSW5kZXgodGhpcy5fY2hhbmdlVGFibGVUYWJsZUluZGV4KHRhYmxlTmFtZSwgb3BlcmF0aW9uKSlcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBhd2FpdCBmbHVzaEJhdGNoKClcbiAgICAgICAgICBhd2FpdCB0aGlzLl9leGVjdXRlQ2hhbmdlVGFibGVPcGVyYXRpb24odGFibGVOYW1lLCBvcGVyYXRpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgZmx1c2hCYXRjaCgpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgVGFibGVJbmRleCBmb3IgYSBiYXRjaCBmcm9tIGEgcmVjb3JkZWQgYWRkSW5kZXggb3BlcmF0aW9uLFxuICAgKiByZXNvbHZpbmcgdGhlIGRlZmF1bHQgYWRkSW5kZXggbmFtZSBlYWdlcmx5IHNvIGEgY29tYmluZWQgTXlTUUwgQUxURVJcbiAgICogbmV2ZXIgc2lsZW50bHkgbmFtZXMgdGhlIGluZGV4IGRpZmZlcmVudGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NoYW5nZS10YWJsZS5qc1wiKS5DaGFuZ2VUYWJsZUFkZEluZGV4T3BlcmF0aW9uVHlwZX0gb3BlcmF0aW9uIC0gUmVjb3JkZWQgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7VGFibGVJbmRleH0gLSBUaGUgdGFibGUgaW5kZXguXG4gICAqL1xuICBfY2hhbmdlVGFibGVUYWJsZUluZGV4KHRhYmxlTmFtZSwgb3BlcmF0aW9uKSB7XG4gICAgY29uc3Qge2FyZ3MsIGNvbHVtbnN9ID0gb3BlcmF0aW9uXG4gICAgLy8gQW4gaWZOb3RFeGlzdHMgaW5kZXggbmV2ZXIgcmVhY2hlcyBiYXRjaGluZyAoaXQgaXMgZmx1c2hlZCBzdGFuZGFsb25lKSxcbiAgICAvLyBzbyB0aGUgY29tYmluZWQgQUxURVIgY2Fubm90IGNhcnJ5IHRoYXQgZ3VhcmQuXG4gICAgY29uc3Qge25hbWUsIC4uLnJlc3RJbmRleEFyZ3N9ID0gYXJncyB8fCB7fVxuICAgIGNvbnN0IGluZGV4TmFtZSA9IG5hbWUgfHwgbmV3IENyZWF0ZUluZGV4QmFzZSh7Y29sdW1ucywgZHJpdmVyOiB0aGlzLmdldERyaXZlcigpLCB0YWJsZU5hbWV9KS5nZW5lcmF0ZUluZGV4TmFtZSgpXG5cbiAgICByZXR1cm4gbmV3IFRhYmxlSW5kZXgoY29sdW1ucywgT2JqZWN0LmFzc2lnbih7fSwgcmVzdEluZGV4QXJncywge25hbWU6IGluZGV4TmFtZX0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgc2luZ2xlIHJlY29yZGVkIGNoYW5nZVRhYmxlIG9wZXJhdGlvbiB0aHJvdWdoIHRoZSBleGlzdGluZ1xuICAgKiBtaWdyYXRpb24gaGVscGVyIHdpdGggdGhlIHNhbWUgc2VtYW50aWNzIGFzIGEgZGlyZWN0IGhlbHBlciBjYWxsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NoYW5nZS10YWJsZS5qc1wiKS5DaGFuZ2VUYWJsZU9wZXJhdGlvblR5cGV9IG9wZXJhdGlvbiAtIFJlY29yZGVkIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9leGVjdXRlQ2hhbmdlVGFibGVPcGVyYXRpb24odGFibGVOYW1lLCBvcGVyYXRpb24pIHtcbiAgICBzd2l0Y2ggKG9wZXJhdGlvbi50eXBlKSB7XG4gICAgICBjYXNlIFwiYWRkQ29sdW1uXCI6XG4gICAgICAgIGF3YWl0IHRoaXMuYWRkQ29sdW1uKHRhYmxlTmFtZSwgb3BlcmF0aW9uLmNvbHVtbk5hbWUsIG9wZXJhdGlvbi5jb2x1bW5UeXBlLCBvcGVyYXRpb24uYXJncylcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJyZW1vdmVDb2x1bW5cIjpcbiAgICAgICAgYXdhaXQgdGhpcy5yZW1vdmVDb2x1bW4odGFibGVOYW1lLCBvcGVyYXRpb24uY29sdW1uTmFtZSlcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJhZGRJbmRleFwiOlxuICAgICAgICBhd2FpdCB0aGlzLmFkZEluZGV4KHRhYmxlTmFtZSwgb3BlcmF0aW9uLmNvbHVtbnMsIG9wZXJhdGlvbi5hcmdzKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcInJlbW92ZUluZGV4XCI6XG4gICAgICAgIGF3YWl0IHRoaXMucmVtb3ZlSW5kZXgodGFibGVOYW1lLCBvcGVyYXRpb24ubmFtZU9yQ29sdW1ucywgb3BlcmF0aW9uLmFyZ3MpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlIFwiYWRkUmVmZXJlbmNlXCI6XG4gICAgICAgIGF3YWl0IHRoaXMuYWRkUmVmZXJlbmNlKHRhYmxlTmFtZSwgb3BlcmF0aW9uLnJlZmVyZW5jZU5hbWUsIG9wZXJhdGlvbi5hcmdzIHx8IHt9KVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcInJlbW92ZVJlZmVyZW5jZVwiOlxuICAgICAgICBhd2FpdCB0aGlzLnJlbW92ZVJlZmVyZW5jZSh0YWJsZU5hbWUsIG9wZXJhdGlvbi5yZWZlcmVuY2VOYW1lLCBvcGVyYXRpb24uYXJncylcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJyZW5hbWVDb2x1bW5cIjpcbiAgICAgICAgYXdhaXQgdGhpcy5yZW5hbWVDb2x1bW4odGFibGVOYW1lLCBvcGVyYXRpb24ub2xkQ29sdW1uTmFtZSwgb3BlcmF0aW9uLm5ld0NvbHVtbk5hbWUpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlIFwiY2hhbmdlQ29sdW1uTnVsbFwiOlxuICAgICAgICBhd2FpdCB0aGlzLmNoYW5nZUNvbHVtbk51bGwodGFibGVOYW1lLCBvcGVyYXRpb24uY29sdW1uTmFtZSwgb3BlcmF0aW9uLm51bGxhYmxlKVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biBjaGFuZ2UgdGFibGUgb3BlcmF0aW9uXCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGUodGFibGVOYW1lKSB7XG4gICAgYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5kcm9wVGFibGUodGFibGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuYW1lIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRDb2x1bW5OYW1lIC0gUHJldmlvdXMgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdDb2x1bW5OYW1lIC0gTmV3IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lQ29sdW1uKHRhYmxlTmFtZSwgb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZSkge1xuICAgIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkucmVuYW1lQ29sdW1uKHRhYmxlTmFtZSwgb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHdpdGggV2hldGhlciB0YWJsZSBleGlzdHMuXG4gICAqL1xuICBhc3luYyB0YWJsZUV4aXN0cyh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLnRhYmxlRXhpc3RzKHRhYmxlTmFtZSlcblxuICAgIHJldHVybiBleGlzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBIZWxwZXI6IGNyZWF0ZXMgdGhlIHNoYXJlZCBhdWRpdCB0YWJsZXMgKGBhdWRpdF9hY3Rpb25zYCxcbiAgICogYGF1ZGl0X2F1ZGl0YWJsZV90eXBlc2AsIGBhdWRpdHNgKS4gQ2FsbCBmcm9tIGB1cCgpYCBpbiBhIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHt7aWQ/OiB7dHlwZT86IHN0cmluZ319fSBbb3B0aW9uc10gLSBJRCBjb2x1bW4gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjcmVhdGVTaGFyZWRBdWRpdFRhYmxlcyhvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBpZCA9IG9wdGlvbnMuaWQgfHwge31cblxuICAgIGF3YWl0IHRoaXMuY3JlYXRlVGFibGUoXCJhdWRpdF9hY3Rpb25zXCIsIHtpZH0sICh0YWJsZSkgPT4ge1xuICAgICAgdGFibGUuc3RyaW5nKFwiYWN0aW9uXCIsIHtpbmRleDoge3VuaXF1ZTogdHJ1ZX0sIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnRpbWVzdGFtcHMoKVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmNyZWF0ZVRhYmxlKFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVzXCIsIHtpZH0sICh0YWJsZSkgPT4ge1xuICAgICAgdGFibGUuc3RyaW5nKFwibmFtZVwiLCB7aW5kZXg6IHt1bmlxdWU6IHRydWV9LCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS50aW1lc3RhbXBzKClcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5jcmVhdGVUYWJsZShcImF1ZGl0c1wiLCB7aWR9LCAodGFibGUpID0+IHtcbiAgICAgIHRhYmxlLnJlZmVyZW5jZXMoXCJhdWRpdF9hY3Rpb25cIiwge2ZvcmVpZ25LZXk6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnJlZmVyZW5jZXMoXCJhdWRpdF9hdWRpdGFibGVfdHlwZVwiLCB7Zm9yZWlnbktleTogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUucmVmZXJlbmNlcyhcImF1ZGl0YWJsZVwiLCB7bnVsbDogZmFsc2UsIHBvbHltb3JwaGljOiB0cnVlfSlcbiAgICAgIHRhYmxlLmpzb24oXCJhdWRpdGVkX2NoYW5nZXNcIilcbiAgICAgIHRhYmxlLmpzb24oXCJwYXJhbXNcIilcbiAgICAgIHRhYmxlLnRpbWVzdGFtcHMoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSGVscGVyOiBjcmVhdGVzIGEgZGVkaWNhdGVkIGF1ZGl0IHRhYmxlIGZvciBhIG1vZGVsIChlLmcuXG4gICAqIGBwcm9qZWN0X2F1ZGl0c2AgZm9yIHRoZSBgcHJvamVjdHNgIHRhYmxlKS4gQ2FsbCBmcm9tIGB1cCgpYFxuICAgKiBpbiBhIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsVGFibGVOYW1lIC0gTW9kZWwgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RzXCIpLlxuICAgKiBAcGFyYW0ge3tpZD86IHt0eXBlPzogc3RyaW5nfX19IFtvcHRpb25zXSAtIElEIGNvbHVtbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBUaGUgY3JlYXRlZCBhdWRpdCB0YWJsZSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlRGVkaWNhdGVkQXVkaXRUYWJsZShtb2RlbFRhYmxlTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgYXVkaXRUYWJsZSA9IGRlZGljYXRlZEF1ZGl0VGFibGVOYW1lKG1vZGVsVGFibGVOYW1lKVxuICAgIGNvbnN0IGlkID0gb3B0aW9ucy5pZCB8fCB7fVxuXG4gICAgYXdhaXQgdGhpcy5jcmVhdGVUYWJsZShhdWRpdFRhYmxlLCB7aWR9LCAodGFibGUpID0+IHtcbiAgICAgIGNvbnN0IHJlZktleSA9IGluZmxlY3Rpb24uc2luZ3VsYXJpemUobW9kZWxUYWJsZU5hbWUpXG5cbiAgICAgIHRhYmxlLnJlZmVyZW5jZXMocmVmS2V5LCB7Zm9yZWlnbktleTogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUucmVmZXJlbmNlcyhcImF1ZGl0X2FjdGlvblwiLCB7Zm9yZWlnbktleTogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuanNvbihcImF1ZGl0ZWRfY2hhbmdlc1wiKVxuICAgICAgdGFibGUuanNvbihcInBhcmFtc1wiKVxuICAgICAgdGFibGUudGltZXN0YW1wcygpXG4gICAgfSlcblxuICAgIHJldHVybiBhdWRpdFRhYmxlXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSBmb3IgYSBtb2RlbCB0YWJsZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbFRhYmxlTmFtZSAtIE1vZGVsIHRhYmxlIG5hbWUgKGUuZy4gXCJwcm9qZWN0c1wiKS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IERlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdF9hdWRpdHNcIikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZShtb2RlbFRhYmxlTmFtZSkge1xuICBpZiAobW9kZWxUYWJsZU5hbWUuZW5kc1dpdGgoXCJzXCIpKSB7XG4gICAgcmV0dXJuIGAke21vZGVsVGFibGVOYW1lLnNsaWNlKDAsIC0xKX1fYXVkaXRzYFxuICB9XG5cbiAgcmV0dXJuIGAke21vZGVsVGFibGVOYW1lfV9hdWRpdHNgXG59XG4iXX0=