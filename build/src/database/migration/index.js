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
import ChangeTable from "./change-table.js";
import CreateIndexBase from "../query/create-index-base.js";
import TableColumn from "../table-data/table-column.js";
import TableData from "../table-data/index.js";
import TableIndex from "../table-data/table-index.js";
class NotImplementedError extends Error {
}
export { NotImplementedError };
export default class VelociousDatabaseMigration {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0aW9uL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWiwrRkFBK0Y7QUFDL0Y7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7R0FHRztBQUNIOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBRSxrQ0FBa0MsRUFBRSxNQUFNLHdCQUF3QixDQUFBO0FBQzNFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLGdDQUFnQyxDQUFBO0FBQzFELE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sV0FBVyxNQUFNLCtCQUErQixDQUFBO0FBQ3ZELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sVUFBVSxNQUFNLDhCQUE4QixDQUFBO0FBQ3JELE1BQU0sbUJBQW9CLFNBQVEsS0FBSztDQUFHO0FBRTFDLE9BQU8sRUFBQyxtQkFBbUIsRUFBQyxDQUFBO0FBRTVCLE1BQU0sQ0FBQyxPQUFPLE9BQU8sMEJBQTBCO0lBQzdDOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsV0FBVyxDQUFDLG1CQUFtQjtRQUNwQyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsbUJBQW1CLENBQUE7SUFDakQsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxzQkFBc0I7UUFDM0IsT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsa0JBQWtCLEdBQUcsU0FBUyxFQUFFLEVBQUUsRUFBQztRQUM3RCxJQUFJLENBQUMsa0JBQWtCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFBO1FBQ3hFLElBQUksQ0FBQyxFQUFFO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUV6QyxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsa0JBQWtCLENBQUE7UUFDN0MsSUFBSSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUE7SUFDZixDQUFDO0lBRUQsc0JBQXNCO1FBQ3BCLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBRTVFLE9BQU8sSUFBSSxDQUFDLG1CQUFtQixDQUFBO0lBQ2pDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFBLENBQUMsQ0FBQztJQUMvQixVQUFVLEtBQUssT0FBTyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRXhDLEtBQUssQ0FBQyxNQUFNO1FBQ1YsTUFBTSxJQUFJLG1CQUFtQixDQUFDLDBCQUEwQixDQUFDLENBQUE7SUFDM0QsQ0FBQztJQUVELEtBQUssQ0FBQyxFQUFFO1FBQ04sTUFBTSxJQUFJLG1CQUFtQixDQUFDLDBCQUEwQixDQUFDLENBQUE7SUFDM0QsQ0FBQztJQUVELEtBQUssQ0FBQyxJQUFJO1FBQ1IsTUFBTSxJQUFJLG1CQUFtQixDQUFDLDBCQUEwQixDQUFDLENBQUE7SUFDM0QsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUc7UUFDZixPQUFPLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUMzQyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsSUFBSTtRQUNyRCxJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtRQUV4RCxNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDbEYsTUFBTSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFMUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsZUFBZSxDQUFDLENBQUE7UUFFaEQsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRTdELEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ25DLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLFNBQVMsRUFBRSxVQUFVO1FBQ3RDLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN6RCxNQUFNLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUUxQyxTQUFTLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxlQUFlLENBQUMsQ0FBQTtRQUVoRCxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFN0QsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsSUFBSTtRQUNyQyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sT0FBTyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFBO1FBQzNFLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQ25DO1lBQ0UsT0FBTyxFQUFFLGlCQUFpQjtZQUMxQixTQUFTO1NBQ1YsRUFDRCxJQUFJLENBQ0wsQ0FBQTtRQUNELE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLGVBQWUsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUVwRSxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNuQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsSUFBSSxHQUFHLEVBQUU7UUFDbkQsTUFBTSxFQUFDLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUVoQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsTUFBTSxlQUFlLEdBQUcsSUFBSSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFDL0UsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsZUFBZSxDQUFDLEVBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRXZGLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ25DLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsYUFBYTtRQUN2QyxJQUFJLE9BQU8sYUFBYSxLQUFLLFFBQVE7WUFBRSxPQUFPLGFBQWEsQ0FBQTtRQUUzRCxNQUFNLFdBQVcsR0FBRyxJQUFJLGVBQWUsQ0FBQztZQUN0QyxPQUFPLEVBQUUsYUFBYTtZQUN0QixNQUFNLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUN4QixTQUFTO1NBQ1YsQ0FBQyxDQUFBO1FBRUYsT0FBTyxXQUFXLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUN4QyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNIOzs7Ozs7Ozs7O09BVUc7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsSUFBSSxHQUFHLEVBQUU7UUFDckQsTUFBTSxFQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsb0JBQW9CLEVBQUUsbUJBQW1CLEVBQUUsR0FBRyxRQUFRLEVBQUMsR0FBRyxJQUFJLENBQUE7UUFFdkYsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLE1BQU0sdUJBQXVCLEdBQUcsVUFBVSxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNwRSxNQUFNLDJCQUEyQixHQUFHLG1CQUFtQixJQUFJLFVBQVUsQ0FBQyxTQUFTLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtRQUN4RyxNQUFNLGtCQUFrQixHQUFHLFVBQVUsSUFBSSxHQUFHLHVCQUF1QixLQUFLLENBQUE7UUFDeEUsTUFBTSw0QkFBNEIsR0FBRyxvQkFBb0IsSUFBSSxJQUFJLENBQUE7UUFDakUsTUFBTSxZQUFZLEdBQUcsSUFBSSxJQUFJLE1BQU0sU0FBUyxJQUFJLGFBQWEsRUFBRSxDQUFBO1FBRS9ELE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLGFBQWEsQ0FDbEMsU0FBUyxFQUNULGtCQUFrQixFQUNsQiwyQkFBMkIsRUFDM0IsNEJBQTRCLEVBQzVCO1lBQ0UsZUFBZSxFQUFFLElBQUk7WUFDckIsSUFBSSxFQUFFLFlBQVk7U0FDbkIsQ0FDRixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxFQUFFLGFBQWEsRUFBRSxJQUFJLEdBQUcsRUFBRTtRQUN4RCxNQUFNLEVBQUMsVUFBVSxFQUFFLEdBQUcsUUFBUSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBRXRDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixNQUFNLGtCQUFrQixHQUFHLFVBQVUsSUFBSSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQTtRQUNyRixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDL0IsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZCLElBQUkscUJBQXFCLEdBQUcsQ0FBQyxDQUFBO1FBRTdCLEtBQUssSUFBSSxjQUFjLEdBQUcsQ0FBQyxHQUFJLGNBQWMsRUFBRSxFQUFFLENBQUM7WUFDaEQsTUFBTSxLQUFLLEdBQUcsTUFBTSxNQUFNLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBRXBELElBQUksQ0FBQyxLQUFLO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxTQUFTLGlCQUFpQixDQUFDLENBQUE7WUFFaEUsTUFBTSxXQUFXLEdBQUcsTUFBTSxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUE7WUFDaEQsTUFBTSxtQkFBbUIsR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFLElBQUksa0JBQWtCLENBQUMsQ0FBQTtZQUVoSCxJQUFJLG1CQUFtQixDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDckMsSUFBSSxjQUFjLEtBQUssQ0FBQztvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixTQUFTLElBQUksa0JBQWtCLEVBQUUsQ0FBQyxDQUFBO2dCQUVqRyxPQUFNO1lBQ1IsQ0FBQztZQUVELElBQUksY0FBYyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUN6QixlQUFlLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFBO1lBQzlDLENBQUM7aUJBQU0sSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLElBQUkscUJBQXFCLEVBQUUsQ0FBQztnQkFDL0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsU0FBUyxJQUFJLGtCQUFrQixFQUFFLENBQUMsQ0FBQTtZQUNyRyxDQUFDO1lBRUQsSUFBSSxjQUFjLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQ3RDLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELFNBQVMsSUFBSSxrQkFBa0IsRUFBRSxDQUFDLENBQUE7WUFDeEcsQ0FBQztZQUVELHFCQUFxQixHQUFHLG1CQUFtQixDQUFDLE1BQU0sQ0FBQTtZQUNsRCxNQUFNLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNsRSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsSUFBSTtRQUMvQyxNQUFNLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUNwRSxNQUFNLFVBQVUsR0FBRyxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQTtRQUUvRCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsTUFBTSxVQUFVLEdBQUcsSUFBSSxJQUFJLFNBQVMsQ0FBQTtRQUNwQyxNQUFNLFVBQVUsR0FBRyxRQUFRLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFDLElBQUksRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBRXhFLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUNuRSxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUUsRUFBQyxNQUFNLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUU5RCxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2YsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxhQUFhLENBQUMsQ0FBQTtRQUNwRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0g7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxTQUFTLEVBQUUsYUFBYSxFQUFFLElBQUksR0FBRyxFQUFFO1FBQ3ZELE1BQU0sRUFBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLEdBQUcsUUFBUSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBRWpELGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixNQUFNLGtCQUFrQixHQUFHLFVBQVUsSUFBSSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQTtRQUNyRixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDL0IsTUFBTSxLQUFLLEdBQUcsTUFBTSxNQUFNLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRXBELElBQUksQ0FBQyxLQUFLO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxTQUFTLFNBQVMsaUJBQWlCLENBQUMsQ0FBQTtRQUVoRSxNQUFNLFdBQVcsR0FBRyxNQUFNLEtBQUssQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUVoRCxLQUFLLE1BQU0sVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3JDLElBQUksVUFBVSxDQUFDLGFBQWEsRUFBRSxJQUFJLGtCQUFrQjtnQkFBRSxTQUFRO1lBRTlELE1BQU0sTUFBTSxDQUFDLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUN0RCxDQUFDO1FBRUQsTUFBTSxpQkFBaUIsR0FBRyxTQUFTLElBQUksSUFBSSxDQUFDLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQTtRQUM3RixNQUFNLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUN4QyxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDNUMsTUFBTSxnQkFBZ0IsR0FBRyxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUE7WUFFL0MsT0FBTyxDQUFDLEtBQUssQ0FBQyxZQUFZLEVBQUU7Z0JBQzFCLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxpQkFBaUI7Z0JBQ3BDLGdCQUFnQixDQUFDLE1BQU0sSUFBSSxDQUFDO2dCQUM1QixnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsSUFBSSxrQkFBa0IsQ0FBQTtRQUM3QyxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksY0FBYyxFQUFFLENBQUM7WUFDbkIsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUM3RCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO0lBQ3hELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxRQUFRO1FBQ3BELE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUU5RCxJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxTQUFTLGlCQUFpQixDQUFDLENBQUE7UUFFaEUsTUFBTSxNQUFNLEdBQUcsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXRELElBQUksQ0FBQyxNQUFNO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLFVBQVUsNEJBQTRCLFNBQVMsRUFBRSxDQUFDLENBQUE7UUFFekYsTUFBTSxNQUFNLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQ3ZDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxJQUFJLEdBQUcsRUFBRTtRQUNyRCxNQUFNLEVBQUMsY0FBYyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUU1RSxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFckUsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQztnQkFDM0MsY0FBYztnQkFDZCx3QkFBd0I7Z0JBQ3hCLFNBQVM7YUFDVixDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsK0JBQStCLENBQUMsTUFBTTtRQUMxQyxJQUFJLE1BQU07WUFBRSxPQUFPLE1BQU0sQ0FBQTtRQUV6QixPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUM7YUFDeEMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7YUFDL0IsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLElBQUksbUJBQW1CLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7SUFDaEcsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsaUNBQWlDLENBQUMsRUFBQyxjQUFjLEVBQUUsd0JBQXdCLEVBQUUsU0FBUyxFQUFDO1FBQzNGLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUMvQixNQUFNLEtBQUssR0FBRyxNQUFNLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUMxRCxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBRWhGLElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVoQyxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLCtCQUErQixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzFFLE1BQU0sZUFBZSxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUMsQ0FBQTtRQUN0RCxNQUFNLFNBQVMsR0FBRyxlQUFlO2FBQzlCLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsQ0FBQzthQUNuRCxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDYixNQUFNLElBQUksR0FBRyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVSxTQUFTLFNBQVMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFM0YsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN2QixLQUFLLE1BQU0sVUFBVSxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNqQyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQzdCLE1BQU0sY0FBYyxHQUFHLGtDQUFrQyxDQUFDLEtBQUssRUFBRTtvQkFDL0QsWUFBWSxFQUFFLE1BQU0sQ0FBQyxPQUFPLEVBQUU7b0JBQzlCLHdCQUF3QjtpQkFDekIsQ0FBQyxDQUFBO2dCQUVGLElBQUksY0FBYyxLQUFLLEtBQUs7b0JBQUUsU0FBUTtnQkFFdEMsTUFBTSxNQUFNLENBQUMsS0FBSyxDQUFDO21CQUNSLE1BQU0sQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDO2dCQUMvQixNQUFNLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDO2tCQUM5RCxNQUFNLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztTQUN0RixDQUFDLENBQUE7WUFDSixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsNEJBQTRCLENBQUMsRUFBQyxjQUFjLEVBQUUsS0FBSyxFQUFDO1FBQ3hELE1BQU0sZUFBZSxHQUFHLGNBQWMsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBRXpELElBQUksZUFBZTtZQUFFLE9BQU8sZUFBZSxDQUFBO1FBRTNDLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQzthQUM5QixNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxNQUFNLENBQUMsQ0FBQzthQUN0RSxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUNBQXFDLENBQUMsTUFBTTtRQUMxQyxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFakQsT0FBTyxVQUFVLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsK0JBQStCLENBQUMsS0FBSztRQUN6QyxNQUFNLGlCQUFpQixHQUFHLENBQUMsTUFBTSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO1FBRS9GLElBQUksaUJBQWlCLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xDLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLEtBQUssQ0FBQyxPQUFPLEVBQUUsY0FBYyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBQ2pILENBQUM7UUFFRCxPQUFPLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ3ZDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsU0FBUyxFQUFFLFVBQVU7UUFDdEMsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRTlELElBQUksS0FBSyxFQUFFLENBQUM7WUFDVixNQUFNLE1BQU0sR0FBRyxNQUFNLEtBQUssQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFdEQsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDWCxPQUFPLElBQUksQ0FBQTtZQUNiLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsU0FBUztRQUNwQyxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFbkYsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNWLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQztnQkFDN0MsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLElBQUksU0FBUyxFQUFFLENBQUM7b0JBQ2pDLE9BQU8sSUFBSSxDQUFBO2dCQUNiLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxjQUFjLEVBQUUsRUFBQyxLQUFLLEVBQUM7UUFDcEQsSUFBSSxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDMUQsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDM0UsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsY0FBYyxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBQy9ELENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxFQUFFLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7SUFDekUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNIOzs7Ozs7O09BT0c7SUFDSDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSTtRQUNyQyxJQUFJLElBQUksQ0FBQTtRQUNSLElBQUksUUFBUSxDQUFBO1FBRVosSUFBSSxPQUFPLElBQUksSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUM5QixJQUFJLEdBQUcsRUFBRSxDQUFBO1lBQ1QsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUNqQixDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksR0FBRyxJQUFJLENBQUE7WUFDWCxRQUFRLEdBQUcsSUFBSSxDQUFBO1FBQ2pCLENBQUM7UUFFRCxNQUFNLEVBQUMsRUFBRSxHQUFHLEVBQUUsRUFBRSxXQUFXLEdBQUcsS0FBSyxFQUFFLEdBQUcsUUFBUSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQ3hELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUMvQixNQUFNLHFCQUFxQixHQUFHLE1BQU0sQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUNyRCxJQUFJLFNBQVMsRUFBRSxNQUFNLEVBQUUsVUFBVSxDQUFBO1FBRWpDLElBQUksRUFBRSxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQ2pCLENBQUMsRUFBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxVQUFVLEVBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQTtZQUV4RCxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDM0IsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNaLE1BQU0sR0FBRyxxQkFBcUIsQ0FBQTtRQUNoQyxDQUFDO1FBQ0QsTUFBTSx5QkFBeUIsR0FBRyxNQUFNLENBQUMsNkJBQTZCLEVBQUUsRUFBRSxDQUFBO1FBQzFFLE1BQU0sV0FBVyxHQUFHLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLGdCQUFnQixHQUFHLFdBQVcsSUFBSSxNQUFNLENBQUE7UUFDOUMsTUFBTSx5QkFBeUIsR0FBRyxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUNyRixJQUFJLGVBQWUsR0FBRyx5QkFBeUIsQ0FBQyxRQUFRLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFBO1FBRTNFLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUNyQixlQUFlLEdBQUcsS0FBSyxDQUFBO1lBRXZCLElBQUkseUJBQXlCLEVBQUUsQ0FBQztnQkFDOUIsSUFBSSxTQUFTLEtBQUssU0FBUyxFQUFFLENBQUM7b0JBQzVCLFNBQVMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxRQUFRLENBQUE7Z0JBQzVCLENBQUM7WUFDSCxDQUFDO2lCQUFNLElBQUksU0FBUyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUNuQyw2RkFBNkY7Z0JBQzdGLFNBQVMsR0FBRyxTQUFTLENBQUE7WUFDdkIsQ0FBQztZQUNELHdGQUF3RjtRQUMxRixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsU0FBUyxFQUFFLEVBQUMsV0FBVyxFQUFFLGNBQWMsRUFBRSxxQkFBcUIsRUFBQyxDQUFDLENBQUE7UUFFaEcsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxDQUFDLE1BQU0sSUFBSSxTQUFTLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBRXRGLElBQUksRUFBRSxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQ2pCLFNBQVMsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEVBQUMsYUFBYSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUM5SCxDQUFDO1FBRUQsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNiLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUNyQixDQUFDO1FBRUQsTUFBTSxJQUFJLEdBQUcsTUFBTSxNQUFNLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRW5ELEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUMzQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFFSDs7O09BR0c7SUFFSDs7Ozs7O09BTUc7SUFDSDs7Ozs7OztPQU9HO0lBQ0g7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUk7UUFDckMsSUFBSSxJQUFJLEdBQUcsa0NBQWtDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNsRCxJQUFJLFFBQVEsQ0FBQTtRQUVaLElBQUksT0FBTyxJQUFJLElBQUksVUFBVSxFQUFFLENBQUM7WUFDOUIsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUNqQixDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksR0FBRyxJQUFJLElBQUksRUFBRSxDQUFBO1lBQ2pCLFFBQVEsR0FBRyxJQUFJLENBQUE7UUFDakIsQ0FBQztRQUVELElBQUksT0FBTyxRQUFRLElBQUksVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtRQUV2RSxNQUFNLEVBQUMsSUFBSSxHQUFHLEtBQUssRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUV4QyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsTUFBTSxLQUFLLEdBQUcsSUFBSSxXQUFXLENBQUMsRUFBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRTFDLE1BQU0sUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRXJCLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsYUFBYSxFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQ3BGLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsS0FBSyxDQUFDLDZCQUE2QixDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUM7UUFDL0QsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksSUFBSSxNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUV4RCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDbkIsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztnQkFDbkMsTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFBO1lBQy9ELENBQUM7WUFFRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksS0FBSyxHQUFHLElBQUksU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRXBDLE1BQU0sVUFBVSxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQzVCLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDO2dCQUFFLE9BQU07WUFFNUUsTUFBTSxJQUFJLEdBQUcsTUFBTSxNQUFNLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRS9DLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7Z0JBQ3ZCLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUN6QixDQUFDO1lBRUQsS0FBSyxHQUFHLElBQUksU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ2xDLENBQUMsQ0FBQTtRQUVELEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7WUFDbkMsUUFBUSxTQUFTLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ3ZCLEtBQUssV0FBVyxFQUFFLENBQUM7b0JBQ2pCLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVTt3QkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUE7b0JBRWxFLHVFQUF1RTtvQkFDdkUsd0RBQXdEO29CQUN4RCxJQUFJLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQzt3QkFBRSxNQUFNLFVBQVUsRUFBRSxDQUFBO29CQUVyRCxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksV0FBVyxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUMsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO29CQUN0SSxNQUFLO2dCQUNQLENBQUM7Z0JBQ0QsS0FBSyxjQUFjO29CQUNqQix1RUFBdUU7b0JBQ3ZFLHdEQUF3RDtvQkFDeEQsSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUMsTUFBTSxHQUFHLENBQUM7d0JBQUUsTUFBTSxVQUFVLEVBQUUsQ0FBQTtvQkFFckQsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLFdBQVcsQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsQ0FBQTtvQkFDMUUsTUFBSztnQkFDUCxLQUFLLFVBQVU7b0JBQ2IsdUVBQXVFO29CQUN2RSxtRUFBbUU7b0JBQ25FLHVFQUF1RTtvQkFDdkUsdUNBQXVDO29CQUN2QyxJQUFJLENBQUMsTUFBTSxDQUFDLHdCQUF3QixFQUFFLElBQUksU0FBUyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUUsQ0FBQzt3QkFDdEUsTUFBTSxVQUFVLEVBQUUsQ0FBQTt3QkFDbEIsTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFBO29CQUMvRCxDQUFDO3lCQUFNLENBQUM7d0JBQ04sS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUE7b0JBQ25FLENBQUM7b0JBQ0QsTUFBSztnQkFDUDtvQkFDRSxNQUFNLFVBQVUsRUFBRSxDQUFBO29CQUNsQixNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUE7WUFDakUsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLFVBQVUsRUFBRSxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsc0JBQXNCLENBQUMsU0FBUyxFQUFFLFNBQVM7UUFDekMsTUFBTSxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUMsR0FBRyxTQUFTLENBQUE7UUFDakMsMEVBQTBFO1FBQzFFLGlEQUFpRDtRQUNqRCxNQUFNLEVBQUMsSUFBSSxFQUFFLEdBQUcsYUFBYSxFQUFDLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQTtRQUMzQyxNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksSUFBSSxlQUFlLENBQUMsRUFBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFakgsT0FBTyxJQUFJLFVBQVUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsYUFBYSxFQUFFLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUNyRixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDRCQUE0QixDQUFDLFNBQVMsRUFBRSxTQUFTO1FBQ3JELFFBQVEsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3ZCLEtBQUssV0FBVztnQkFDZCxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQzNGLE1BQUs7WUFDUCxLQUFLLGNBQWM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUN4RCxNQUFLO1lBQ1AsS0FBSyxVQUFVO2dCQUNiLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQ2pFLE1BQUs7WUFDUCxLQUFLLGFBQWE7Z0JBQ2hCLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQzFFLE1BQUs7WUFDUCxLQUFLLGNBQWM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQyxDQUFBO2dCQUNqRixNQUFLO1lBQ1AsS0FBSyxpQkFBaUI7Z0JBQ3BCLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQzlFLE1BQUs7WUFDUCxLQUFLLGNBQWM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsYUFBYSxDQUFDLENBQUE7Z0JBQ3BGLE1BQUs7WUFDUCxLQUFLLGtCQUFrQjtnQkFDckIsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUNoRixNQUFLO1lBQ1A7Z0JBQ0UsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFBO1FBQ3JELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUztRQUN2QixNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsU0FBUyxFQUFFLGFBQWEsRUFBRSxhQUFhO1FBQ3hELE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLFlBQVksQ0FBQyxTQUFTLEVBQUUsYUFBYSxFQUFFLGFBQWEsQ0FBQyxDQUFBO0lBQzlFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxTQUFTO1FBQ3pCLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUU1RCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxPQUFPLEdBQUcsRUFBRTtRQUN4QyxNQUFNLEVBQUUsR0FBRyxPQUFPLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQTtRQUUzQixNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsZUFBZSxFQUFFLEVBQUMsRUFBRSxFQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUN0RCxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFDLEtBQUssRUFBRSxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM1RCxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDcEIsQ0FBQyxDQUFDLENBQUE7UUFFRixNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsdUJBQXVCLEVBQUUsRUFBQyxFQUFFLEVBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQzlELEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLEVBQUMsS0FBSyxFQUFFLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQzFELEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNwQixDQUFDLENBQUMsQ0FBQTtRQUVGLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsRUFBQyxFQUFFLEVBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQy9DLEtBQUssQ0FBQyxVQUFVLENBQUMsY0FBYyxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUNqRSxLQUFLLENBQUMsVUFBVSxDQUFDLHNCQUFzQixFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUN6RSxLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVcsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDL0QsS0FBSyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1lBQzdCLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDcEIsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ3BCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLENBQUMsY0FBYyxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQzFELE1BQU0sVUFBVSxHQUFHLHVCQUF1QixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQzFELE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFBO1FBRTNCLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxVQUFVLEVBQUUsRUFBQyxFQUFFLEVBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ2pELE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLENBQUE7WUFFckQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ3pELEtBQUssQ0FBQyxVQUFVLENBQUMsY0FBYyxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUNqRSxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDN0IsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNwQixLQUFLLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDcEIsQ0FBQyxDQUFDLENBQUE7UUFFRixPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0NBQ0Y7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLHVCQUF1QixDQUFDLGNBQWM7SUFDcEQsSUFBSSxjQUFjLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakMsT0FBTyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtJQUNoRCxDQUFDO0lBRUQsT0FBTyxHQUFHLGNBQWMsU0FBUyxDQUFBO0FBQ25DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5UYWJsZUNvbHVtbkFyZ3NUeXBlfSBBZGRDb2x1bW5BcmdzVHlwZSAqL1xuLyoqXG4gKiBDcmVhdGVUYWJsZUlkQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENyZWF0ZVRhYmxlSWRBcmdzVHlwZVxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RlZmF1bHRdIC0gRGVmYXVsdCB2YWx1ZSBmb3IgdGhlIElEIGNvbHVtbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBDb2x1bW4gdHlwZSBmb3IgdGhlIElEIGNvbHVtbi5cbiAqL1xuLyoqXG4gKiBDcmVhdGVUYWJsZUFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVUYWJsZUFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSB0YWJsZSBhbHJlYWR5IGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7Q3JlYXRlVGFibGVJZEFyZ3NUeXBlIHwgZmFsc2V9IFtpZF0gLSBJRCBjb2x1bW4gb3B0aW9ucyBvciBmYWxzZSB0byBza2lwIElELlxuICovXG4vKipcbiAqIENyZWF0ZVRhYmxlQ2FsbGJhY2tUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7KHRhYmxlOiBUYWJsZURhdGEpID0+IHZvaWR9IENyZWF0ZVRhYmxlQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogTGVnYWN5TG9jYWxEYXRlVGltZXNNaWdyYXRpb25BcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gTGVnYWN5TG9jYWxEYXRlVGltZXNNaWdyYXRpb25BcmdzVHlwZVxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IFtjb2x1bW5zQnlUYWJsZV0gLSBFeHBsaWNpdCBkYXRldGltZSBjb2x1bW5zIGtleWVkIGJ5IHRhYmxlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xlZ2FjeUxvY2FsT2Zmc2V0TWludXRlc10gLSBVVEMtbWludXMtbG9jYWwgb2Zmc2V0IGluIG1pbnV0ZXMgZm9yIGxlZ2FjeSByb3dzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW3RhYmxlc10gLSBUYWJsZXMgdG8gbWlncmF0ZS4gRGVmYXVsdHMgdG8gYWxsIG5vbi1pbnRlcm5hbCB0YWJsZXMuXG4gKi9cblxuaW1wb3J0IHsgY29udmVydExlZ2FjeURhdGVWYWx1ZVRvVXRjU3RvcmFnZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgQ2hhbmdlVGFibGUgZnJvbSBcIi4vY2hhbmdlLXRhYmxlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleEJhc2UgZnJvbSBcIi4uL3F1ZXJ5L2NyZWF0ZS1pbmRleC1iYXNlLmpzXCJcbmltcG9ydCBUYWJsZUNvbHVtbiBmcm9tIFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVGFibGVJbmRleCBmcm9tIFwiLi4vdGFibGUtZGF0YS90YWJsZS1pbmRleC5qc1wiXG5jbGFzcyBOb3RJbXBsZW1lbnRlZEVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuZXhwb3J0IHtOb3RJbXBsZW1lbnRlZEVycm9yfVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZU1pZ3JhdGlvbiB7XG4gIC8qKlxuICAgKiBSdW5zIG9uIGRhdGFiYXNlcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZGF0YWJhc2VJZGVudGlmaWVycyAtIERhdGFiYXNlIGlkZW50aWZpZXJzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgb25EYXRhYmFzZXMoZGF0YWJhc2VJZGVudGlmaWVycykge1xuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gLSBUaGUgZGF0YWJhc2UgaWRlbnRpZmllcnMuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIgPSBcImRlZmF1bHRcIiwgZGJ9KSB7XG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGFiYXNlIGlkZW50aWZpZXIgZ2l2ZW5cIilcbiAgICBpZiAoIWRiKSB0aHJvdyBuZXcgRXJyb3IoXCJObyAnZGInIGdpdmVuXCIpXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5fZGIgPSBkYlxuICB9XG5cbiAgX2dldERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICBpZiAoIXRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YWJhc2UgaWRlbnRpZmllciBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkcml2ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgZHJpdmVyLlxuICAgKi9cbiAgZ2V0RHJpdmVyKCkgeyByZXR1cm4gdGhpcy5fZGIgfVxuICBjb25uZWN0aW9uKCkgeyByZXR1cm4gdGhpcy5nZXREcml2ZXIoKSB9XG5cbiAgYXN5bmMgY2hhbmdlKCkge1xuICAgIHRocm93IG5ldyBOb3RJbXBsZW1lbnRlZEVycm9yKFwiJ2NoYW5nZScgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICBhc3luYyB1cCgpIHtcbiAgICB0aHJvdyBuZXcgTm90SW1wbGVtZW50ZWRFcnJvcihcIidjaGFuZ2UnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgYXN5bmMgZG93bigpIHtcbiAgICB0aHJvdyBuZXcgTm90SW1wbGVtZW50ZWRFcnJvcihcIidjaGFuZ2UnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIGV4ZWN1dGUuXG4gICAqL1xuICBhc3luYyBleGVjdXRlKHNxbCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtBZGRDb2x1bW5BcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZGRDb2x1bW4odGFibGVOYW1lLCBjb2x1bW5OYW1lLCBjb2x1bW5UeXBlLCBhcmdzKSB7XG4gICAgaWYgKCFjb2x1bW5UeXBlKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb2x1bW4gdHlwZSBnaXZlblwiKVxuXG4gICAgY29uc3QgdGFibGVDb2x1bW5BcmdzID0gT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IGNvbHVtblR5cGV9LCBhcmdzKVxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgdGFibGVEYXRhLmFkZENvbHVtbihjb2x1bW5OYW1lLCB0YWJsZUNvbHVtbkFyZ3MpXG5cbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUNvbHVtbih0YWJsZU5hbWUsIGNvbHVtbk5hbWUpIHtcbiAgICBjb25zdCB0YWJsZUNvbHVtbkFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcm9wQ29sdW1uOiB0cnVlfSlcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRDb2x1bW4oY29sdW1uTmFtZSwgdGFibGVDb2x1bW5BcmdzKVxuXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZEluZGV4QXJnc1R5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gQWRkSW5kZXhBcmdzVHlwZVxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSBpbmRleCBhbHJlYWR5IGV4aXN0cy5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtuYW1lXSAtIEV4cGxpY2l0IGluZGV4IG5hbWUgdG8gdXNlLlxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IFt1bmlxdWVdIC0gV2hldGhlciB0aGUgaW5kZXggc2hvdWxkIGJlIHVuaXF1ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZSBvciBhcnJheSBvZiBjb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QWRkSW5kZXhBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZGRJbmRleCh0YWJsZU5hbWUsIGNvbHVtbnMsIGFyZ3MpIHtcbiAgICBjb25zdCBub3JtYWxpemVkQ29sdW1ucyA9IHR5cGVvZiBjb2x1bW5zID09PSBcInN0cmluZ1wiID8gW2NvbHVtbnNdIDogY29sdW1uc1xuICAgIGNvbnN0IGNyZWF0ZUluZGV4QXJncyA9IE9iamVjdC5hc3NpZ24oXG4gICAgICB7XG4gICAgICAgIGNvbHVtbnM6IG5vcm1hbGl6ZWRDb2x1bW5zLFxuICAgICAgICB0YWJsZU5hbWVcbiAgICAgIH0sXG4gICAgICBhcmdzXG4gICAgKVxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLmNyZWF0ZUluZGV4U1FMcyhjcmVhdGVJbmRleEFyZ3MpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlSW5kZXhBcmdzVHlwZSB0eXBlLlxuICAgKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVJbmRleEFyZ3NUeXBlXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lIHRvIHJlbW92ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IG5hbWVPckNvbHVtbnMgLSBJbmRleCBuYW1lIG9yIGNvbHVtbnMgd2hvc2UgZGVmYXVsdCBhZGRJbmRleCBuYW1lIHNob3VsZCBiZSByZW1vdmVkLlxuICAgKiBAcGFyYW0ge1JlbW92ZUluZGV4QXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXgodGFibGVOYW1lLCBuYW1lT3JDb2x1bW5zLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCB7bmFtZSwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHJlbW92ZUluZGV4TmFtZSA9IG5hbWUgfHwgdGhpcy5fcmVtb3ZlSW5kZXhOYW1lKHRhYmxlTmFtZSwgbmFtZU9yQ29sdW1ucylcbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5yZW1vdmVJbmRleFNRTHMoe25hbWU6IHJlbW92ZUluZGV4TmFtZSwgdGFibGVOYW1lfSlcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gbmFtZU9yQ29sdW1ucyAtIEluZGV4IG5hbWUgb3IgY29sdW1ucy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgaW5kZXggbmFtZS5cbiAgICovXG4gIF9yZW1vdmVJbmRleE5hbWUodGFibGVOYW1lLCBuYW1lT3JDb2x1bW5zKSB7XG4gICAgaWYgKHR5cGVvZiBuYW1lT3JDb2x1bW5zID09PSBcInN0cmluZ1wiKSByZXR1cm4gbmFtZU9yQ29sdW1uc1xuXG4gICAgY29uc3QgY3JlYXRlSW5kZXggPSBuZXcgQ3JlYXRlSW5kZXhCYXNlKHtcbiAgICAgIGNvbHVtbnM6IG5hbWVPckNvbHVtbnMsXG4gICAgICBkcml2ZXI6IHRoaXMuZ2V0RHJpdmVyKCksXG4gICAgICB0YWJsZU5hbWVcbiAgICB9KVxuXG4gICAgcmV0dXJuIGNyZWF0ZUluZGV4LmdlbmVyYXRlSW5kZXhOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRGb3JlaWduS2V5QXJnc1R5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gQWRkRm9yZWlnbktleUFyZ3NUeXBlXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29sdW1uTmFtZV0gLSBPdmVycmlkZSB0aGUgZGVyaXZlZCBGSyBjb2x1bW4gbmFtZSAoZGVmYXVsdDogYCR7cmVmZXJlbmNlX3VuZGVyc2NvcmVkfV9pZGApLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gT3ZlcnJpZGUgdGhlIGRlcml2ZWQgY29uc3RyYWludCBuYW1lIChkZWZhdWx0OiBgZmtfJHt0YWJsZU5hbWV9XyR7cmVmZXJlbmNlTmFtZX1gKS5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtyZWZlcmVuY2VkQ29sdW1uTmFtZV0gLSBPdmVycmlkZSB0aGUgcmVmZXJlbmNlZCBjb2x1bW4gbmFtZSAoZGVmYXVsdDogYGlkYCkuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcmVmZXJlbmNlZFRhYmxlTmFtZV0gLSBPdmVycmlkZSB0aGUgZGVyaXZlZCByZWZlcmVuY2VkIHRhYmxlIChkZWZhdWx0OiBwbHVyYWxpemVkIGByZWZlcmVuY2VOYW1lYCkuXG4gICAqL1xuICAvKipcbiAgICogUnVucyBhZGQgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSB0aGUgRksgbGl2ZXMgb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWZlcmVuY2VOYW1lIC0gU2luZ3VsYXIgcmVmZXJlbmNlIG5hbWUuIERlZmF1bHRzIGRlcml2ZVxuICAgKiAgIHRoZSBGSyBjb2x1bW4gYXMgYCR7cmVmZXJlbmNlfV9pZGAsIHRoZSByZWZlcmVuY2VkIHRhYmxlIGJ5IHBsdXJhbGl6aW5nXG4gICAqICAgdGhlIHJlZmVyZW5jZSwgdGhlIHJlZmVyZW5jZWQgY29sdW1uIGFzIGBpZGAsIGFuZCB0aGUgY29uc3RyYWludCBuYW1lXG4gICAqICAgYXMgYGZrXyR7dGFibGVOYW1lfV8ke3JlZmVyZW5jZU5hbWV9YC4gT3ZlcnJpZGUgYW55IG9mIHRob3NlIHZpYSBgYXJnc2BcbiAgICogICB3aGVuIHRoZSBzY2hlbWEgZG9lc24ndCBmb2xsb3cgdGhlIGNvbnZlbnRpb24uXG4gICAqIEBwYXJhbSB7QWRkRm9yZWlnbktleUFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZGRGb3JlaWduS2V5KHRhYmxlTmFtZSwgcmVmZXJlbmNlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbHVtbk5hbWUsIG5hbWUsIHJlZmVyZW5jZWRDb2x1bW5OYW1lLCByZWZlcmVuY2VkVGFibGVOYW1lLCAuLi5yZXN0QXJnc30gPSBhcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgcmVmZXJlbmNlTmFtZVVuZGVyc2NvcmUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUocmVmZXJlbmNlTmFtZSlcbiAgICBjb25zdCByZXNvbHZlZFJlZmVyZW5jZWRUYWJsZU5hbWUgPSByZWZlcmVuY2VkVGFibGVOYW1lIHx8IGluZmxlY3Rpb24ucGx1cmFsaXplKHJlZmVyZW5jZU5hbWVVbmRlcnNjb3JlKVxuICAgIGNvbnN0IHJlc29sdmVkQ29sdW1uTmFtZSA9IGNvbHVtbk5hbWUgfHwgYCR7cmVmZXJlbmNlTmFtZVVuZGVyc2NvcmV9X2lkYFxuICAgIGNvbnN0IHJlc29sdmVkUmVmZXJlbmNlZENvbHVtbk5hbWUgPSByZWZlcmVuY2VkQ29sdW1uTmFtZSB8fCBcImlkXCJcbiAgICBjb25zdCByZXNvbHZlZE5hbWUgPSBuYW1lIHx8IGBma18ke3RhYmxlTmFtZX1fJHtyZWZlcmVuY2VOYW1lfWBcblxuICAgIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuYWRkRm9yZWlnbktleShcbiAgICAgIHRhYmxlTmFtZSxcbiAgICAgIHJlc29sdmVkQ29sdW1uTmFtZSxcbiAgICAgIHJlc29sdmVkUmVmZXJlbmNlZFRhYmxlTmFtZSxcbiAgICAgIHJlc29sdmVkUmVmZXJlbmNlZENvbHVtbk5hbWUsXG4gICAgICB7XG4gICAgICAgIGlzTmV3Rm9yZWlnbktleTogdHJ1ZSxcbiAgICAgICAgbmFtZTogcmVzb2x2ZWROYW1lXG4gICAgICB9XG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZUZvcmVpZ25LZXlBcmdzVHlwZSB0eXBlLlxuICAgKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVGb3JlaWduS2V5QXJnc1R5cGVcbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb2x1bW5OYW1lXSAtIE92ZXJyaWRlIHRoZSBkZXJpdmVkIGZvcmVpZ24ta2V5IGNvbHVtbiBuYW1lLlxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgdGhlIGZvcmVpZ24ga2V5IGxpdmVzIG9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVmZXJlbmNlTmFtZSAtIFNpbmd1bGFyIHJlZmVyZW5jZSBuYW1lIHVzZWQgdG8gZGVyaXZlIHRoZSBGSyBjb2x1bW4uXG4gICAqIEBwYXJhbSB7UmVtb3ZlRm9yZWlnbktleUFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25hbCBvdmVycmlkZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZW1vdmVGb3JlaWduS2V5KHRhYmxlTmFtZSwgcmVmZXJlbmNlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbHVtbk5hbWUsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCByZXNvbHZlZENvbHVtbk5hbWUgPSBjb2x1bW5OYW1lIHx8IGAke2luZmxlY3Rpb24udW5kZXJzY29yZShyZWZlcmVuY2VOYW1lKX1faWRgXG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5nZXREcml2ZXIoKVxuICAgIGxldCBtYXhpbXVtUmVtb3ZhbHMgPSAwXG4gICAgbGV0IHByZXZpb3VzTWF0Y2hpbmdDb3VudCA9IDBcblxuICAgIGZvciAobGV0IHJlbW92YWxBdHRlbXB0ID0gMDsgOyByZW1vdmFsQXR0ZW1wdCsrKSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRyaXZlci5nZXRUYWJsZUJ5TmFtZSh0YWJsZU5hbWUpXG5cbiAgICAgIGlmICghdGFibGUpIHRocm93IG5ldyBFcnJvcihgVGFibGUgJHt0YWJsZU5hbWV9IGRvZXMgbm90IGV4aXN0YClcblxuICAgICAgY29uc3QgZm9yZWlnbktleXMgPSBhd2FpdCB0YWJsZS5nZXRGb3JlaWduS2V5cygpXG4gICAgICBjb25zdCBtYXRjaGluZ0ZvcmVpZ25LZXlzID0gZm9yZWlnbktleXMuZmlsdGVyKChmb3JlaWduS2V5KSA9PiBmb3JlaWduS2V5LmdldENvbHVtbk5hbWUoKSA9PSByZXNvbHZlZENvbHVtbk5hbWUpXG5cbiAgICAgIGlmIChtYXRjaGluZ0ZvcmVpZ25LZXlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAocmVtb3ZhbEF0dGVtcHQgPT09IDApIHRocm93IG5ldyBFcnJvcihgTm8gZm9yZWlnbiBrZXkgb24gJHt0YWJsZU5hbWV9LiR7cmVzb2x2ZWRDb2x1bW5OYW1lfWApXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChyZW1vdmFsQXR0ZW1wdCA9PT0gMCkge1xuICAgICAgICBtYXhpbXVtUmVtb3ZhbHMgPSBtYXRjaGluZ0ZvcmVpZ25LZXlzLmxlbmd0aFxuICAgICAgfSBlbHNlIGlmIChtYXRjaGluZ0ZvcmVpZ25LZXlzLmxlbmd0aCA+PSBwcmV2aW91c01hdGNoaW5nQ291bnQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGb3JlaWduIGtleSByZW1vdmFsIGRpZCBub3QgcmVkdWNlIG1hdGNoZXMgb24gJHt0YWJsZU5hbWV9LiR7cmVzb2x2ZWRDb2x1bW5OYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGlmIChyZW1vdmFsQXR0ZW1wdCA+PSBtYXhpbXVtUmVtb3ZhbHMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGb3JlaWduIGtleSByZW1vdmFsIGV4Y2VlZGVkIGV4cGVjdGVkIG1hdGNoZXMgb24gJHt0YWJsZU5hbWV9LiR7cmVzb2x2ZWRDb2x1bW5OYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHByZXZpb3VzTWF0Y2hpbmdDb3VudCA9IG1hdGNoaW5nRm9yZWlnbktleXMubGVuZ3RoXG4gICAgICBhd2FpdCBkcml2ZXIucmVtb3ZlRm9yZWlnbktleSh0YWJsZU5hbWUsIG1hdGNoaW5nRm9yZWlnbktleXNbMF0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWZlcmVuY2VOYW1lIC0gUmVmZXJlbmNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZm9yZWlnbktleV0gLSBXaGV0aGVyIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLm51bGxdIC0gV2hldGhlciBudWxsYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnR5cGVdIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnVuaXF1ZV0gLSBXaGV0aGVyIHVuaXF1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFkZFJlZmVyZW5jZSh0YWJsZU5hbWUsIHJlZmVyZW5jZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCB7Zm9yZWlnbktleSwgbnVsbDogbnVsbGFibGUsIHR5cGUsIHVuaXF1ZSwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBgJHtpbmZsZWN0aW9uLnVuZGVyc2NvcmUocmVmZXJlbmNlTmFtZSl9X2lkYFxuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSB0eXBlIHx8IFwiaW50ZWdlclwiXG4gICAgY29uc3QgY29sdW1uQXJncyA9IG51bGxhYmxlICE9PSB1bmRlZmluZWQgPyB7bnVsbDogbnVsbGFibGV9IDogdW5kZWZpbmVkXG5cbiAgICBhd2FpdCB0aGlzLmFkZENvbHVtbih0YWJsZU5hbWUsIGNvbHVtbk5hbWUsIGNvbHVtblR5cGUsIGNvbHVtbkFyZ3MpXG4gICAgYXdhaXQgdGhpcy5hZGRJbmRleCh0YWJsZU5hbWUsIFtjb2x1bW5OYW1lXSwge3VuaXF1ZTogdW5pcXVlfSlcblxuICAgIGlmIChmb3JlaWduS2V5KSB7XG4gICAgICBhd2FpdCB0aGlzLmFkZEZvcmVpZ25LZXkodGFibGVOYW1lLCByZWZlcmVuY2VOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVSZWZlcmVuY2VBcmdzVHlwZSB0eXBlLlxuICAgKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVSZWZlcmVuY2VBcmdzVHlwZVxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbHVtbk5hbWVdIC0gT3ZlcnJpZGUgdGhlIGRlcml2ZWQgcmVmZXJlbmNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2luZGV4TmFtZV0gLSBFeHBsaWNpdCBnZW5lcmF0ZWQgaW5kZXggbmFtZSB0byByZW1vdmUuXG4gICAqL1xuICAvKipcbiAgICogUnVucyByZW1vdmUgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlZmVyZW5jZU5hbWUgLSBSZWZlcmVuY2UgbmFtZS5cbiAgICogQHBhcmFtIHtSZW1vdmVSZWZlcmVuY2VBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9uYWwgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlUmVmZXJlbmNlKHRhYmxlTmFtZSwgcmVmZXJlbmNlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbHVtbk5hbWUsIGluZGV4TmFtZSwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHJlc29sdmVkQ29sdW1uTmFtZSA9IGNvbHVtbk5hbWUgfHwgYCR7aW5mbGVjdGlvbi51bmRlcnNjb3JlKHJlZmVyZW5jZU5hbWUpfV9pZGBcbiAgICBjb25zdCBkcml2ZXIgPSB0aGlzLmdldERyaXZlcigpXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkcml2ZXIuZ2V0VGFibGVCeU5hbWUodGFibGVOYW1lKVxuXG4gICAgaWYgKCF0YWJsZSkgdGhyb3cgbmV3IEVycm9yKGBUYWJsZSAke3RhYmxlTmFtZX0gZG9lcyBub3QgZXhpc3RgKVxuXG4gICAgY29uc3QgZm9yZWlnbktleXMgPSBhd2FpdCB0YWJsZS5nZXRGb3JlaWduS2V5cygpXG5cbiAgICBmb3IgKGNvbnN0IGZvcmVpZ25LZXkgb2YgZm9yZWlnbktleXMpIHtcbiAgICAgIGlmIChmb3JlaWduS2V5LmdldENvbHVtbk5hbWUoKSAhPSByZXNvbHZlZENvbHVtbk5hbWUpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IGRyaXZlci5yZW1vdmVGb3JlaWduS2V5KHRhYmxlTmFtZSwgZm9yZWlnbktleSlcbiAgICB9XG5cbiAgICBjb25zdCBleHBlY3RlZEluZGV4TmFtZSA9IGluZGV4TmFtZSB8fCB0aGlzLl9yZW1vdmVJbmRleE5hbWUodGFibGVOYW1lLCBbcmVzb2x2ZWRDb2x1bW5OYW1lXSlcbiAgICBjb25zdCBpbmRleGVzID0gYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpXG4gICAgY29uc3QgZ2VuZXJhdGVkSW5kZXggPSBpbmRleGVzLmZpbmQoKGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpbmRleENvbHVtbk5hbWVzID0gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKVxuXG4gICAgICByZXR1cm4gIWluZGV4LmlzUHJpbWFyeUtleSgpICYmXG4gICAgICAgIGluZGV4LmdldE5hbWUoKSA9PSBleHBlY3RlZEluZGV4TmFtZSAmJlxuICAgICAgICBpbmRleENvbHVtbk5hbWVzLmxlbmd0aCA9PSAxICYmXG4gICAgICAgIGluZGV4Q29sdW1uTmFtZXNbMF0gPT0gcmVzb2x2ZWRDb2x1bW5OYW1lXG4gICAgfSlcblxuICAgIGlmIChnZW5lcmF0ZWRJbmRleCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVJbmRleCh0YWJsZU5hbWUsIGdlbmVyYXRlZEluZGV4LmdldE5hbWUoKSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbW92ZUNvbHVtbih0YWJsZU5hbWUsIHJlc29sdmVkQ29sdW1uTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5nZSBjb2x1bW4gbnVsbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbnVsbGFibGUgLSBXaGV0aGVyIG51bGxhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2hhbmdlQ29sdW1uTnVsbCh0YWJsZU5hbWUsIGNvbHVtbk5hbWUsIG51bGxhYmxlKSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSlcblxuICAgIGlmICghdGFibGUpIHRocm93IG5ldyBFcnJvcihgVGFibGUgJHt0YWJsZU5hbWV9IGRvZXMgbm90IGV4aXN0YClcblxuICAgIGNvbnN0IGNvbHVtbiA9IGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKCFjb2x1bW4pIHRocm93IG5ldyBFcnJvcihgQ29sdW1uICR7Y29sdW1uTmFtZX0gZG9lcyBub3QgZXhpc3QgaW4gdGFibGUgJHt0YWJsZU5hbWV9YClcblxuICAgIGF3YWl0IGNvbHVtbi5jaGFuZ2VOdWxsYWJsZShudWxsYWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNaWdyYXRlcyBsZWdhY3kgdGltZXpvbmUtbGVzcyBsb2NhbCBkYXRldGltZSByb3dzIGludG8gVVRDIGRhdGV0aW1lIHN0b3JhZ2UuXG4gICAqIE5ldyBTUUxpdGUgVVRDIHJvd3MgaW5jbHVkZSBhIHRpbWV6b25lIHN1ZmZpeCBhbmQgYXJlIHNraXBwZWQuXG4gICAqIEBwYXJhbSB7TGVnYWN5TG9jYWxEYXRlVGltZXNNaWdyYXRpb25BcmdzVHlwZX0gW2FyZ3NdIC0gTWlncmF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBtaWdyYXRlTGVnYWN5TG9jYWxEYXRlVGltZXNUb1V0Y1N0b3JhZ2UoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbHVtbnNCeVRhYmxlLCBsZWdhY3lMb2NhbE9mZnNldE1pbnV0ZXMsIHRhYmxlcywgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHRhYmxlTmFtZXMgPSBhd2FpdCB0aGlzLl9sZWdhY3lMb2NhbERhdGVUaW1lc1RhYmxlTmFtZXModGFibGVzKVxuXG4gICAgZm9yIChjb25zdCB0YWJsZU5hbWUgb2YgdGFibGVOYW1lcykge1xuICAgICAgYXdhaXQgdGhpcy5fbWlncmF0ZUxlZ2FjeUxvY2FsRGF0ZVRpbWVzVGFibGUoe1xuICAgICAgICBjb2x1bW5zQnlUYWJsZSxcbiAgICAgICAgbGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzLFxuICAgICAgICB0YWJsZU5hbWVcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRhYmxlIG5hbWVzIGZvciBhIGxlZ2FjeSBsb2NhbCBkYXRldGltZSBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCB1bmRlZmluZWR9IHRhYmxlcyAtIEV4cGxpY2l0IHRhYmxlIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gVGFibGUgbmFtZXMuXG4gICAqL1xuICBhc3luYyBfbGVnYWN5TG9jYWxEYXRlVGltZXNUYWJsZU5hbWVzKHRhYmxlcykge1xuICAgIGlmICh0YWJsZXMpIHJldHVybiB0YWJsZXNcblxuICAgIHJldHVybiAoYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5nZXRUYWJsZXMoKSlcbiAgICAgIC5tYXAoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkpXG4gICAgICAuZmlsdGVyKCh0YWJsZU5hbWUpID0+IHRhYmxlTmFtZSAhPSBcInNjaGVtYV9taWdyYXRpb25zXCIgJiYgIXRhYmxlTmFtZS5zdGFydHNXaXRoKFwic3FsaXRlX1wiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNaWdyYXRlcyBvbmUgdGFibGUncyBsZWdhY3kgbG9jYWwgZGF0ZXRpbWUgdmFsdWVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtbnNCeVRhYmxlIC0gRXhwbGljaXQgY29sdW1ucyBrZXllZCBieSB0YWJsZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IGFyZ3MubGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzIC0gVVRDLW1pbnVzLWxvY2FsIG9mZnNldCBpbiBtaW51dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX21pZ3JhdGVMZWdhY3lMb2NhbERhdGVUaW1lc1RhYmxlKHtjb2x1bW5zQnlUYWJsZSwgbGVnYWN5TG9jYWxPZmZzZXRNaW51dGVzLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5nZXREcml2ZXIoKVxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZHJpdmVyLmdldFRhYmxlQnlOYW1lT3JGYWlsKHRhYmxlTmFtZSlcbiAgICBjb25zdCBjb2x1bW5zID0gYXdhaXQgdGhpcy5fbGVnYWN5TG9jYWxEYXRlVGltZXNDb2x1bW5zKHtjb2x1bW5zQnlUYWJsZSwgdGFibGV9KVxuXG4gICAgaWYgKGNvbHVtbnMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW4gPSBhd2FpdCB0aGlzLl9sZWdhY3lMb2NhbERhdGVUaW1lc1ByaW1hcnlLZXkodGFibGUpXG4gICAgY29uc3Qgc2VsZWN0ZWRDb2x1bW5zID0gW3ByaW1hcnlLZXlDb2x1bW4sIC4uLmNvbHVtbnNdXG4gICAgY29uc3Qgc2VsZWN0U3FsID0gc2VsZWN0ZWRDb2x1bW5zXG4gICAgICAubWFwKChjb2x1bW5OYW1lKSA9PiBkcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSkpXG4gICAgICAuam9pbihcIiwgXCIpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRyaXZlci5xdWVyeShgU0VMRUNUICR7c2VsZWN0U3FsfSBGUk9NICR7ZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX1gKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIGNvbHVtbnMpIHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSByb3dbY29sdW1uTmFtZV1cbiAgICAgICAgY29uc3QgY29udmVydGVkVmFsdWUgPSBjb252ZXJ0TGVnYWN5RGF0ZVZhbHVlVG9VdGNTdG9yYWdlKHZhbHVlLCB7XG4gICAgICAgICAgZGF0YWJhc2VUeXBlOiBkcml2ZXIuZ2V0VHlwZSgpLFxuICAgICAgICAgIGxlZ2FjeUxvY2FsT2Zmc2V0TWludXRlc1xuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChjb252ZXJ0ZWRWYWx1ZSA9PT0gdmFsdWUpIGNvbnRpbnVlXG5cbiAgICAgICAgYXdhaXQgZHJpdmVyLnF1ZXJ5KGBcbiAgICAgICAgICBVUERBVEUgJHtkcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfVxuICAgICAgICAgIFNFVCAke2RyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX0gPSAke2RyaXZlci5xdW90ZShjb252ZXJ0ZWRWYWx1ZSl9XG4gICAgICAgICAgV0hFUkUgJHtkcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleUNvbHVtbil9ID0gJHtkcml2ZXIucXVvdGUocm93W3ByaW1hcnlLZXlDb2x1bW5dKX1cbiAgICAgICAgYClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZGF0ZS1saWtlIGNvbHVtbnMgZm9yIG9uZSB0YWJsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5zQnlUYWJsZSAtIEV4cGxpY2l0IGNvbHVtbnMga2V5ZWQgYnkgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFibGUgLSBUYWJsZSBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIERhdGUtbGlrZSBjb2x1bW4gbmFtZXMuXG4gICAqL1xuICBhc3luYyBfbGVnYWN5TG9jYWxEYXRlVGltZXNDb2x1bW5zKHtjb2x1bW5zQnlUYWJsZSwgdGFibGV9KSB7XG4gICAgY29uc3QgZXhwbGljaXRDb2x1bW5zID0gY29sdW1uc0J5VGFibGU/Llt0YWJsZS5nZXROYW1lKCldXG5cbiAgICBpZiAoZXhwbGljaXRDb2x1bW5zKSByZXR1cm4gZXhwbGljaXRDb2x1bW5zXG5cbiAgICByZXR1cm4gKGF3YWl0IHRhYmxlLmdldENvbHVtbnMoKSlcbiAgICAgIC5maWx0ZXIoKGNvbHVtbikgPT4gdGhpcy5fbGVnYWN5TG9jYWxEYXRlVGltZXNDb2x1bW5Jc0RhdGVMaWtlKGNvbHVtbikpXG4gICAgICAubWFwKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBjb2x1bW4gc2hvdWxkIGJlIGluY2x1ZGVkIGJ5IGRlZmF1bHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0fSBjb2x1bW4gLSBDb2x1bW4gbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBpcyBkYXRlLWxpa2UuXG4gICAqL1xuICBfbGVnYWN5TG9jYWxEYXRlVGltZXNDb2x1bW5Jc0RhdGVMaWtlKGNvbHVtbikge1xuICAgIGNvbnN0IGNvbHVtblR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpLnRvTG93ZXJDYXNlKClcblxuICAgIHJldHVybiBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZGF0ZVwiKSB8fCBjb2x1bW5UeXBlLmluY2x1ZGVzKFwidGltZXN0YW1wXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNpbmdsZSBwcmltYXJ5IGtleSBjb2x1bW4gZm9yIHJvdyB1cGRhdGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSB0YWJsZSAtIFRhYmxlIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFByaW1hcnkga2V5IGNvbHVtbiBuYW1lLlxuICAgKi9cbiAgYXN5bmMgX2xlZ2FjeUxvY2FsRGF0ZVRpbWVzUHJpbWFyeUtleSh0YWJsZSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW5zID0gKGF3YWl0IHRhYmxlLmdldENvbHVtbnMoKSkuZmlsdGVyKChjb2x1bW4pID0+IGNvbHVtbi5nZXRQcmltYXJ5S2V5KCkpXG5cbiAgICBpZiAocHJpbWFyeUtleUNvbHVtbnMubGVuZ3RoICE9IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZXhhY3RseSBvbmUgcHJpbWFyeSBrZXkgb24gJHt0YWJsZS5nZXROYW1lKCl9IGJ1dCBmb3VuZCAke3ByaW1hcnlLZXlDb2x1bW5zLmxlbmd0aH1gKVxuICAgIH1cblxuICAgIHJldHVybiBwcmltYXJ5S2V5Q29sdW1uc1swXS5nZXROYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbHVtbiBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgY29sdW1uIGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIGNvbHVtbkV4aXN0cyh0YWJsZU5hbWUsIGNvbHVtbk5hbWUpIHtcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuZ2V0VGFibGVCeU5hbWUodGFibGVOYW1lKVxuXG4gICAgaWYgKHRhYmxlKSB7XG4gICAgICBjb25zdCBjb2x1bW4gPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoY29sdW1uTmFtZSlcblxuICAgICAgaWYgKGNvbHVtbikge1xuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKGZhbHNlKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGFuIGluZGV4IHdpdGggdGhlIGdpdmVuIG5hbWUgZXhpc3RzIG9uIGEgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaW5kZXhOYW1lIC0gSW5kZXggbmFtZSB0byBsb29rIGZvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgaW5kZXggZXhpc3RzIG9uIHRoZSB0YWJsZS5cbiAgICovXG4gIGFzeW5jIGluZGV4RXhpc3RzKHRhYmxlTmFtZSwgaW5kZXhOYW1lKSB7XG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSwge3Rocm93RXJyb3I6IGZhbHNlfSlcblxuICAgIGlmICh0YWJsZSkge1xuICAgICAgZm9yIChjb25zdCBpbmRleCBvZiBhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpIHtcbiAgICAgICAgaWYgKGluZGV4LmdldE5hbWUoKSA9PSBpbmRleE5hbWUpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB1cCB0aGUgZGF0YWJhc2Ugc2NoZW1hIGZvciBhIGdhcC1sZXNzIHBvc2l0aW9uYWwgbGlzdC4gQWRkcyB0aGVcbiAgICogcG9zaXRpb24gY29sdW1uIChJTlQgTk9UIE5VTEwpIGlmIGFic2VudCBhbmQgY3JlYXRlcyBhIFVOSVFVRSBpbmRleCBvblxuICAgKiAoc2NvcGUsIHBvc2l0aW9uKS4gVGhpcyBpcyB0aGUgc2NoZW1hLXNpZGUgY291bnRlcnBhcnQgb2ZcbiAgICogYE1vZGVsLmFjdHNBc0xpc3QoKWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcG9zaXRpb25Db2x1bW4gLSBDb2x1bW4gbmFtZSBmb3IgdGhlIHBvc2l0aW9uIChlLmcuIFwicm93X251bWJlclwiKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3B0aW9ucy5zY29wZSAtIENvbHVtbiBuYW1lIGZvciB0aGUgc2NvcGUgKGUuZy4gXCJib2FyZF9jb2x1bW5faWRcIikuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYWRkQWN0c0FzTGlzdCh0YWJsZU5hbWUsIHBvc2l0aW9uQ29sdW1uLCB7c2NvcGV9KSB7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5jb2x1bW5FeGlzdHModGFibGVOYW1lLCBwb3NpdGlvbkNvbHVtbikpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkZENvbHVtbih0YWJsZU5hbWUsIHBvc2l0aW9uQ29sdW1uLCBcImludGVnZXJcIiwge251bGw6IGZhbHNlfSlcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5jaGFuZ2VDb2x1bW5OdWxsKHRhYmxlTmFtZSwgcG9zaXRpb25Db2x1bW4sIGZhbHNlKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYWRkSW5kZXgodGFibGVOYW1lLCBbc2NvcGUsIHBvc2l0aW9uQ29sdW1uXSwge3VuaXF1ZTogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHRhYmxlIHdpdGggZGVmYXVsdCBvcHRpb25zLlxuICAgKiBAb3ZlcmxvYWRcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7Q3JlYXRlVGFibGVDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHRhYmxlIHdpdGggZXhwbGljaXQgb3B0aW9ucy5cbiAgICogQG92ZXJsb2FkXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0NyZWF0ZVRhYmxlQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtDcmVhdGVUYWJsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7Q3JlYXRlVGFibGVBcmdzVHlwZSB8IENyZWF0ZVRhYmxlQ2FsbGJhY2tUeXBlfSBhcmcxIC0gQXJnMS5cbiAgICogQHBhcmFtIHtDcmVhdGVUYWJsZUNhbGxiYWNrVHlwZSB8IHVuZGVmaW5lZH0gW2FyZzJdIC0gQXJnMi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlKHRhYmxlTmFtZSwgYXJnMSwgYXJnMikge1xuICAgIGxldCBhcmdzXG4gICAgbGV0IGNhbGxiYWNrXG5cbiAgICBpZiAodHlwZW9mIGFyZzEgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhcmdzID0ge31cbiAgICAgIGNhbGxiYWNrID0gYXJnMVxuICAgIH0gZWxzZSB7XG4gICAgICBhcmdzID0gYXJnMVxuICAgICAgY2FsbGJhY2sgPSBhcmcyXG4gICAgfVxuXG4gICAgY29uc3Qge2lkID0ge30sIGlmTm90RXhpc3RzID0gZmFsc2UsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcbiAgICBjb25zdCBkcml2ZXIgPSB0aGlzLmdldERyaXZlcigpXG4gICAgY29uc3QgZGVmYXVsdFByaW1hcnlLZXlUeXBlID0gZHJpdmVyLnByaW1hcnlLZXlUeXBlKClcbiAgICBsZXQgaWREZWZhdWx0LCBpZFR5cGUsIHJlc3RBcmdzSWRcblxuICAgIGlmIChpZCAhPT0gZmFsc2UpIHtcbiAgICAgICh7ZGVmYXVsdDogaWREZWZhdWx0LCB0eXBlOiBpZFR5cGUsIC4uLnJlc3RBcmdzSWR9ID0gaWQpXG5cbiAgICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3NJZClcbiAgICB9XG5cbiAgICBpZiAoIWlkVHlwZSkge1xuICAgICAgaWRUeXBlID0gZGVmYXVsdFByaW1hcnlLZXlUeXBlXG4gICAgfVxuICAgIGNvbnN0IGRyaXZlclN1cHBvcnRzRGVmYXVsdFVVSUQgPSBkcml2ZXIuc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQ/LigpXG4gICAgY29uc3QgbG93ZXJJZFR5cGUgPSBpZFR5cGU/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBpc1VVSURQcmltYXJ5S2V5ID0gbG93ZXJJZFR5cGUgPT0gXCJ1dWlkXCJcbiAgICBjb25zdCBudW1lcmljQXV0b0luY3JlbWVudFR5cGVzID0gW1wiaW50XCIsIFwiaW50ZWdlclwiLCBcImJpZ2ludFwiLCBcInNtYWxsaW50XCIsIFwidGlueWludFwiXVxuICAgIGxldCBpZEF1dG9JbmNyZW1lbnQgPSBudW1lcmljQXV0b0luY3JlbWVudFR5cGVzLmluY2x1ZGVzKGxvd2VySWRUeXBlIHx8IFwiXCIpXG5cbiAgICBpZiAoaXNVVUlEUHJpbWFyeUtleSkge1xuICAgICAgaWRBdXRvSW5jcmVtZW50ID0gZmFsc2VcblxuICAgICAgaWYgKGRyaXZlclN1cHBvcnRzRGVmYXVsdFVVSUQpIHtcbiAgICAgICAgaWYgKGlkRGVmYXVsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWREZWZhdWx0ID0gKCkgPT4gXCJVVUlEKClcIlxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGlkRGVmYXVsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIExldCBhcHBsaWNhdGlvbiBjb2RlIGFzc2lnbiBVVUlEcyAoc2VlIERhdGFiYXNlUmVjb3JkLmluc2VydCkgd2hlbiB0aGUgZHJpdmVyIGNhbid0IGRvIGl0LlxuICAgICAgICBpZERlZmF1bHQgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICAgIC8vIElmIGRyaXZlciBkb2Vzbid0IHN1cHBvcnQgVVVJRCgpIGJ1dCB0aGUgY2FsbGVyIGV4cGxpY2l0bHkgc2V0IGEgZGVmYXVsdCwgcmVzcGVjdCBpdC5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSwge2lmTm90RXhpc3RzLCBwcmltYXJ5S2V5VHlwZTogZGVmYXVsdFByaW1hcnlLZXlUeXBlfSlcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIShpZFR5cGUgaW4gdGFibGVEYXRhKSkgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcmltYXJ5IGtleSB0eXBlOiAke2lkVHlwZX1gKVxuXG4gICAgaWYgKGlkICE9PSBmYWxzZSkge1xuICAgICAgdGFibGVEYXRhLmFkZENvbHVtbihcImlkXCIsIHthdXRvSW5jcmVtZW50OiBpZEF1dG9JbmNyZW1lbnQsIGRlZmF1bHQ6IGlkRGVmYXVsdCwgbnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWUsIHR5cGU6IGlkVHlwZX0pXG4gICAgfVxuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayh0YWJsZURhdGEpXG4gICAgfVxuXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IGRyaXZlci5jcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLl9kYi5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoYW5nZVRhYmxlQXJnc1R5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gQ2hhbmdlVGFibGVBcmdzVHlwZVxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IFtidWxrXSAtIENvbWJpbmUgY29tcGF0aWJsZSBjb250aWd1b3VzIERETCBpbnRvIHNpbmdsZVxuICAgKiAgIEFMVEVSIFRBQkxFIHN0YXRlbWVudHMgb24gZHJpdmVycyB0aGF0IHN1cHBvcnQgYnVsayBhbHRlcnMgKE15U1FML01hcmlhREJcbiAgICogICBhbmQgUG9zdGdyZVNRTCkuIGBidWxrYCBjb250cm9scyBEREwgZ3JvdXBpbmcgb25seSwgbm90IHRyYW5zYWN0aW9uYWxcbiAgICogICBhdG9taWNpdHk7IHVuY2hhbmdlZCBkcml2ZXJzIGV4ZWN1dGUgdGhlIHJlY29yZGVkIGNvbW1hbmRzIHNlcXVlbnRpYWxseS5cbiAgICovXG5cbiAgLyoqXG4gICAqIENoYW5nZVRhYmxlQ2FsbGJhY2tUeXBlIHR5cGUuXG4gICAqIEB0eXBlZGVmIHsodGFibGU6IGltcG9ydChcIi4vY2hhbmdlLXRhYmxlLmpzXCIpLmRlZmF1bHQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBDaGFuZ2VUYWJsZUNhbGxiYWNrVHlwZVxuICAgKi9cblxuICAvKipcbiAgICogQ2hhbmdlcyBhIHRhYmxlIHVzaW5nIGEgUmFpbHMtc3R5bGUgdGFibGUtc2NvcGVkIHJlY29yZGVyLlxuICAgKiBAb3ZlcmxvYWRcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7Q2hhbmdlVGFibGVDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICAvKipcbiAgICogQ2hhbmdlcyBhIHRhYmxlIHdpdGggZXhwbGljaXQgb3B0aW9ucy5cbiAgICogQG92ZXJsb2FkXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0NoYW5nZVRhYmxlQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtDaGFuZ2VUYWJsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5nZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7Q2hhbmdlVGFibGVBcmdzVHlwZSB8IENoYW5nZVRhYmxlQ2FsbGJhY2tUeXBlfSBhcmcxIC0gQXJnMS5cbiAgICogQHBhcmFtIHtDaGFuZ2VUYWJsZUNhbGxiYWNrVHlwZSB8IHVuZGVmaW5lZH0gW2FyZzJdIC0gQXJnMi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNoYW5nZVRhYmxlKHRhYmxlTmFtZSwgYXJnMSwgYXJnMikge1xuICAgIGxldCBhcmdzID0gLyoqIEB0eXBlIHtDaGFuZ2VUYWJsZUFyZ3NUeXBlfSAqLyAoe30pXG4gICAgbGV0IGNhbGxiYWNrXG5cbiAgICBpZiAodHlwZW9mIGFyZzEgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjYWxsYmFjayA9IGFyZzFcbiAgICB9IGVsc2Uge1xuICAgICAgYXJncyA9IGFyZzEgfHwge31cbiAgICAgIGNhbGxiYWNrID0gYXJnMlxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjYWxsYmFjayBnaXZlblwiKVxuXG4gICAgY29uc3Qge2J1bGsgPSBmYWxzZSwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IENoYW5nZVRhYmxlKHt0YWJsZU5hbWV9KVxuXG4gICAgYXdhaXQgY2FsbGJhY2sodGFibGUpXG5cbiAgICBhd2FpdCB0aGlzLl9leGVjdXRlQ2hhbmdlVGFibGVPcGVyYXRpb25zKHRhYmxlTmFtZSwgdGFibGUuZ2V0T3BlcmF0aW9ucygpLCB7YnVsa30pXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgcmVjb3JkZWQgY2hhbmdlVGFibGUgb3BlcmF0aW9ucy4gV2l0aCBgYnVsa2AgZW5hYmxlZCBvbiBhXG4gICAqIHN1cHBvcnRpbmcgZHJpdmVyLCBjb21wYXRpYmxlIGNvbnRpZ3VvdXMgY29sdW1uIG9wZXJhdGlvbnMgYWNjdW11bGF0ZSBpbnRvXG4gICAqIGEgc2luZ2xlIFRhYmxlRGF0YSBmbHVzaGVkIHRocm91Z2ggYGFsdGVyVGFibGVTUUxzYDsgaW5jb21wYXRpYmxlIGNvbW1hbmRzXG4gICAqIGZsdXNoIHRoZSBiYXRjaCBmaXJzdCBhbmQgcnVuIHRocm91Z2ggdGhlIGV4aXN0aW5nIG1pZ3JhdGlvbiBoZWxwZXJzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NoYW5nZS10YWJsZS5qc1wiKS5DaGFuZ2VUYWJsZU9wZXJhdGlvblR5cGVbXX0gb3BlcmF0aW9ucyAtIFJlY29yZGVkIG9wZXJhdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5idWxrIC0gV2hldGhlciB0byBlbmFibGUgYnVsayBjb21tYW5kIGdyb3VwaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2V4ZWN1dGVDaGFuZ2VUYWJsZU9wZXJhdGlvbnModGFibGVOYW1lLCBvcGVyYXRpb25zLCB7YnVsa30pIHtcbiAgICBjb25zdCBkcml2ZXIgPSB0aGlzLmdldERyaXZlcigpXG4gICAgY29uc3QgYnVsa1N1cHBvcnRlZCA9IGJ1bGsgJiYgZHJpdmVyLnN1cHBvcnRzQnVsa0FsdGVyKClcblxuICAgIGlmICghYnVsa1N1cHBvcnRlZCkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2Ygb3BlcmF0aW9ucykge1xuICAgICAgICBhd2FpdCB0aGlzLl9leGVjdXRlQ2hhbmdlVGFibGVPcGVyYXRpb24odGFibGVOYW1lLCBvcGVyYXRpb24pXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBiYXRjaCA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgY29uc3QgZmx1c2hCYXRjaCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChiYXRjaC5nZXRDb2x1bW5zKCkubGVuZ3RoID09IDAgJiYgYmF0Y2guZ2V0SW5kZXhlcygpLmxlbmd0aCA9PSAwKSByZXR1cm5cblxuICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRyaXZlci5hbHRlclRhYmxlU1FMcyhiYXRjaClcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICBhd2FpdCBkcml2ZXIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBiYXRjaCA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIG9wZXJhdGlvbnMpIHtcbiAgICAgIHN3aXRjaCAob3BlcmF0aW9uLnR5cGUpIHtcbiAgICAgICAgY2FzZSBcImFkZENvbHVtblwiOiB7XG4gICAgICAgICAgaWYgKCFvcGVyYXRpb24uY29sdW1uVHlwZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1uIHR5cGUgZ2l2ZW5cIilcblxuICAgICAgICAgIC8vIEZsdXNoIGFuIGFscmVhZHktcmVjb3JkZWQgaW5kZXggYmF0Y2ggZmlyc3Qgc28gdGhlIGVtaXR0ZWQgU1FMIGtlZXBzXG4gICAgICAgICAgLy8gdGhlIHJlY29yZGVkIGRlY2xhcmF0aW9uIG9yZGVyIChpbmRleCBiZWZvcmUgY29sdW1uKS5cbiAgICAgICAgICBpZiAoYmF0Y2guZ2V0SW5kZXhlcygpLmxlbmd0aCA+IDApIGF3YWl0IGZsdXNoQmF0Y2goKVxuXG4gICAgICAgICAgYmF0Y2guYWRkQ29sdW1uKG5ldyBUYWJsZUNvbHVtbihvcGVyYXRpb24uY29sdW1uTmFtZSwgT2JqZWN0LmFzc2lnbih7aXNOZXdDb2x1bW46IHRydWUsIHR5cGU6IG9wZXJhdGlvbi5jb2x1bW5UeXBlfSwgb3BlcmF0aW9uLmFyZ3MpKSlcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJyZW1vdmVDb2x1bW5cIjpcbiAgICAgICAgICAvLyBGbHVzaCBhbiBhbHJlYWR5LXJlY29yZGVkIGluZGV4IGJhdGNoIGZpcnN0IHNvIHRoZSBlbWl0dGVkIFNRTCBrZWVwc1xuICAgICAgICAgIC8vIHRoZSByZWNvcmRlZCBkZWNsYXJhdGlvbiBvcmRlciAoaW5kZXggYmVmb3JlIGNvbHVtbikuXG4gICAgICAgICAgaWYgKGJhdGNoLmdldEluZGV4ZXMoKS5sZW5ndGggPiAwKSBhd2FpdCBmbHVzaEJhdGNoKClcblxuICAgICAgICAgIGJhdGNoLmFkZENvbHVtbihuZXcgVGFibGVDb2x1bW4ob3BlcmF0aW9uLmNvbHVtbk5hbWUsIHtkcm9wQ29sdW1uOiB0cnVlfSkpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSBcImFkZEluZGV4XCI6XG4gICAgICAgICAgLy8gRHJpdmVycyB3aXRob3V0IGBzdXBwb3J0c0J1bGtBbHRlckluZGV4ZXNgIChQb3N0Z3JlU1FMKSBrZWVwIGluZGV4ZXNcbiAgICAgICAgICAvLyBzdGFuZGFsb25lIGJlY2F1c2UgdGhlaXIgQUxURVIgVEFCTEUgZG9lcyBub3QgY2FycnkgQ1JFQVRFIElOREVYXG4gICAgICAgICAgLy8gY2xhdXNlcy4gQW4gaWZOb3RFeGlzdHMgaW5kZXggaXMgbmV2ZXIgY29tYmluZWQgYmVjYXVzZSB0aGUgY29tYmluZWRcbiAgICAgICAgICAvLyBidWxrIGZvcm0gY2Fubm90IGV4cHJlc3MgdGhhdCBndWFyZC5cbiAgICAgICAgICBpZiAoIWRyaXZlci5zdXBwb3J0c0J1bGtBbHRlckluZGV4ZXMoKSB8fCBvcGVyYXRpb24uYXJncz8uaWZOb3RFeGlzdHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGZsdXNoQmF0Y2goKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fZXhlY3V0ZUNoYW5nZVRhYmxlT3BlcmF0aW9uKHRhYmxlTmFtZSwgb3BlcmF0aW9uKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBiYXRjaC5hZGRJbmRleCh0aGlzLl9jaGFuZ2VUYWJsZVRhYmxlSW5kZXgodGFibGVOYW1lLCBvcGVyYXRpb24pKVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIGF3YWl0IGZsdXNoQmF0Y2goKVxuICAgICAgICAgIGF3YWl0IHRoaXMuX2V4ZWN1dGVDaGFuZ2VUYWJsZU9wZXJhdGlvbih0YWJsZU5hbWUsIG9wZXJhdGlvbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBmbHVzaEJhdGNoKClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBUYWJsZUluZGV4IGZvciBhIGJhdGNoIGZyb20gYSByZWNvcmRlZCBhZGRJbmRleCBvcGVyYXRpb24sXG4gICAqIHJlc29sdmluZyB0aGUgZGVmYXVsdCBhZGRJbmRleCBuYW1lIGVhZ2VybHkgc28gYSBjb21iaW5lZCBNeVNRTCBBTFRFUlxuICAgKiBuZXZlciBzaWxlbnRseSBuYW1lcyB0aGUgaW5kZXggZGlmZmVyZW50bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY2hhbmdlLXRhYmxlLmpzXCIpLkNoYW5nZVRhYmxlQWRkSW5kZXhPcGVyYXRpb25UeXBlfSBvcGVyYXRpb24gLSBSZWNvcmRlZCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZUluZGV4fSAtIFRoZSB0YWJsZSBpbmRleC5cbiAgICovXG4gIF9jaGFuZ2VUYWJsZVRhYmxlSW5kZXgodGFibGVOYW1lLCBvcGVyYXRpb24pIHtcbiAgICBjb25zdCB7YXJncywgY29sdW1uc30gPSBvcGVyYXRpb25cbiAgICAvLyBBbiBpZk5vdEV4aXN0cyBpbmRleCBuZXZlciByZWFjaGVzIGJhdGNoaW5nIChpdCBpcyBmbHVzaGVkIHN0YW5kYWxvbmUpLFxuICAgIC8vIHNvIHRoZSBjb21iaW5lZCBBTFRFUiBjYW5ub3QgY2FycnkgdGhhdCBndWFyZC5cbiAgICBjb25zdCB7bmFtZSwgLi4ucmVzdEluZGV4QXJnc30gPSBhcmdzIHx8IHt9XG4gICAgY29uc3QgaW5kZXhOYW1lID0gbmFtZSB8fCBuZXcgQ3JlYXRlSW5kZXhCYXNlKHtjb2x1bW5zLCBkcml2ZXI6IHRoaXMuZ2V0RHJpdmVyKCksIHRhYmxlTmFtZX0pLmdlbmVyYXRlSW5kZXhOYW1lKClcblxuICAgIHJldHVybiBuZXcgVGFibGVJbmRleChjb2x1bW5zLCBPYmplY3QuYXNzaWduKHt9LCByZXN0SW5kZXhBcmdzLCB7bmFtZTogaW5kZXhOYW1lfSkpXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBzaW5nbGUgcmVjb3JkZWQgY2hhbmdlVGFibGUgb3BlcmF0aW9uIHRocm91Z2ggdGhlIGV4aXN0aW5nXG4gICAqIG1pZ3JhdGlvbiBoZWxwZXIgd2l0aCB0aGUgc2FtZSBzZW1hbnRpY3MgYXMgYSBkaXJlY3QgaGVscGVyIGNhbGwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY2hhbmdlLXRhYmxlLmpzXCIpLkNoYW5nZVRhYmxlT3BlcmF0aW9uVHlwZX0gb3BlcmF0aW9uIC0gUmVjb3JkZWQgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2V4ZWN1dGVDaGFuZ2VUYWJsZU9wZXJhdGlvbih0YWJsZU5hbWUsIG9wZXJhdGlvbikge1xuICAgIHN3aXRjaCAob3BlcmF0aW9uLnR5cGUpIHtcbiAgICAgIGNhc2UgXCJhZGRDb2x1bW5cIjpcbiAgICAgICAgYXdhaXQgdGhpcy5hZGRDb2x1bW4odGFibGVOYW1lLCBvcGVyYXRpb24uY29sdW1uTmFtZSwgb3BlcmF0aW9uLmNvbHVtblR5cGUsIG9wZXJhdGlvbi5hcmdzKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcInJlbW92ZUNvbHVtblwiOlxuICAgICAgICBhd2FpdCB0aGlzLnJlbW92ZUNvbHVtbih0YWJsZU5hbWUsIG9wZXJhdGlvbi5jb2x1bW5OYW1lKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcImFkZEluZGV4XCI6XG4gICAgICAgIGF3YWl0IHRoaXMuYWRkSW5kZXgodGFibGVOYW1lLCBvcGVyYXRpb24uY29sdW1ucywgb3BlcmF0aW9uLmFyZ3MpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlIFwicmVtb3ZlSW5kZXhcIjpcbiAgICAgICAgYXdhaXQgdGhpcy5yZW1vdmVJbmRleCh0YWJsZU5hbWUsIG9wZXJhdGlvbi5uYW1lT3JDb2x1bW5zLCBvcGVyYXRpb24uYXJncylcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJhZGRSZWZlcmVuY2VcIjpcbiAgICAgICAgYXdhaXQgdGhpcy5hZGRSZWZlcmVuY2UodGFibGVOYW1lLCBvcGVyYXRpb24ucmVmZXJlbmNlTmFtZSwgb3BlcmF0aW9uLmFyZ3MgfHwge30pXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlIFwicmVtb3ZlUmVmZXJlbmNlXCI6XG4gICAgICAgIGF3YWl0IHRoaXMucmVtb3ZlUmVmZXJlbmNlKHRhYmxlTmFtZSwgb3BlcmF0aW9uLnJlZmVyZW5jZU5hbWUsIG9wZXJhdGlvbi5hcmdzKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBcInJlbmFtZUNvbHVtblwiOlxuICAgICAgICBhd2FpdCB0aGlzLnJlbmFtZUNvbHVtbih0YWJsZU5hbWUsIG9wZXJhdGlvbi5vbGRDb2x1bW5OYW1lLCBvcGVyYXRpb24ubmV3Q29sdW1uTmFtZSlcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgXCJjaGFuZ2VDb2x1bW5OdWxsXCI6XG4gICAgICAgIGF3YWl0IHRoaXMuY2hhbmdlQ29sdW1uTnVsbCh0YWJsZU5hbWUsIG9wZXJhdGlvbi5jb2x1bW5OYW1lLCBvcGVyYXRpb24ubnVsbGFibGUpXG4gICAgICAgIGJyZWFrXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIGNoYW5nZSB0YWJsZSBvcGVyYXRpb25cIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLmdldERyaXZlcigpLmRyb3BUYWJsZSh0YWJsZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW5hbWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9sZENvbHVtbk5hbWUgLSBQcmV2aW91cyBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld0NvbHVtbk5hbWUgLSBOZXcgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZW5hbWVDb2x1bW4odGFibGVOYW1lLCBvbGRDb2x1bW5OYW1lLCBuZXdDb2x1bW5OYW1lKSB7XG4gICAgYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5yZW5hbWVDb2x1bW4odGFibGVOYW1lLCBvbGRDb2x1bW5OYW1lLCBuZXdDb2x1bW5OYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIHRhYmxlIGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIHRhYmxlRXhpc3RzKHRhYmxlTmFtZSkge1xuICAgIGNvbnN0IGV4aXN0cyA9IGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkudGFibGVFeGlzdHModGFibGVOYW1lKVxuXG4gICAgcmV0dXJuIGV4aXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIEhlbHBlcjogY3JlYXRlcyB0aGUgc2hhcmVkIGF1ZGl0IHRhYmxlcyAoYGF1ZGl0X2FjdGlvbnNgLFxuICAgKiBgYXVkaXRfYXVkaXRhYmxlX3R5cGVzYCwgYGF1ZGl0c2ApLiBDYWxsIGZyb20gYHVwKClgIGluIGEgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3tpZD86IHt0eXBlPzogc3RyaW5nfX19IFtvcHRpb25zXSAtIElEIGNvbHVtbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVNoYXJlZEF1ZGl0VGFibGVzKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGlkID0gb3B0aW9ucy5pZCB8fCB7fVxuXG4gICAgYXdhaXQgdGhpcy5jcmVhdGVUYWJsZShcImF1ZGl0X2FjdGlvbnNcIiwge2lkfSwgKHRhYmxlKSA9PiB7XG4gICAgICB0YWJsZS5zdHJpbmcoXCJhY3Rpb25cIiwge2luZGV4OiB7dW5pcXVlOiB0cnVlfSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUudGltZXN0YW1wcygpXG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuY3JlYXRlVGFibGUoXCJhdWRpdF9hdWRpdGFibGVfdHlwZXNcIiwge2lkfSwgKHRhYmxlKSA9PiB7XG4gICAgICB0YWJsZS5zdHJpbmcoXCJuYW1lXCIsIHtpbmRleDoge3VuaXF1ZTogdHJ1ZX0sIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnRpbWVzdGFtcHMoKVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmNyZWF0ZVRhYmxlKFwiYXVkaXRzXCIsIHtpZH0sICh0YWJsZSkgPT4ge1xuICAgICAgdGFibGUucmVmZXJlbmNlcyhcImF1ZGl0X2FjdGlvblwiLCB7Zm9yZWlnbktleTogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUucmVmZXJlbmNlcyhcImF1ZGl0X2F1ZGl0YWJsZV90eXBlXCIsIHtmb3JlaWduS2V5OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5yZWZlcmVuY2VzKFwiYXVkaXRhYmxlXCIsIHtudWxsOiBmYWxzZSwgcG9seW1vcnBoaWM6IHRydWV9KVxuICAgICAgdGFibGUuanNvbihcImF1ZGl0ZWRfY2hhbmdlc1wiKVxuICAgICAgdGFibGUuanNvbihcInBhcmFtc1wiKVxuICAgICAgdGFibGUudGltZXN0YW1wcygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBIZWxwZXI6IGNyZWF0ZXMgYSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgZm9yIGEgbW9kZWwgKGUuZy5cbiAgICogYHByb2plY3RfYXVkaXRzYCBmb3IgdGhlIGBwcm9qZWN0c2AgdGFibGUpLiBDYWxsIGZyb20gYHVwKClgXG4gICAqIGluIGEgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxUYWJsZU5hbWUgLSBNb2RlbCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdHNcIikuXG4gICAqIEBwYXJhbSB7e2lkPzoge3R5cGU/OiBzdHJpbmd9fX0gW29wdGlvbnNdIC0gSUQgY29sdW1uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFRoZSBjcmVhdGVkIGF1ZGl0IHRhYmxlIG5hbWUuXG4gICAqL1xuICBhc3luYyBjcmVhdGVEZWRpY2F0ZWRBdWRpdFRhYmxlKG1vZGVsVGFibGVOYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBhdWRpdFRhYmxlID0gZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWUobW9kZWxUYWJsZU5hbWUpXG4gICAgY29uc3QgaWQgPSBvcHRpb25zLmlkIHx8IHt9XG5cbiAgICBhd2FpdCB0aGlzLmNyZWF0ZVRhYmxlKGF1ZGl0VGFibGUsIHtpZH0sICh0YWJsZSkgPT4ge1xuICAgICAgY29uc3QgcmVmS2V5ID0gaW5mbGVjdGlvbi5zaW5ndWxhcml6ZShtb2RlbFRhYmxlTmFtZSlcblxuICAgICAgdGFibGUucmVmZXJlbmNlcyhyZWZLZXksIHtmb3JlaWduS2V5OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5yZWZlcmVuY2VzKFwiYXVkaXRfYWN0aW9uXCIsIHtmb3JlaWduS2V5OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5qc29uKFwiYXVkaXRlZF9jaGFuZ2VzXCIpXG4gICAgICB0YWJsZS5qc29uKFwicGFyYW1zXCIpXG4gICAgICB0YWJsZS50aW1lc3RhbXBzKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF1ZGl0VGFibGVcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGRlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIGZvciBhIG1vZGVsIHRhYmxlLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsVGFibGVOYW1lIC0gTW9kZWwgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RzXCIpLlxuICogQHJldHVybnMge3N0cmluZ30gRGVkaWNhdGVkIGF1ZGl0IHRhYmxlIG5hbWUgKGUuZy4gXCJwcm9qZWN0X2F1ZGl0c1wiKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZGljYXRlZEF1ZGl0VGFibGVOYW1lKG1vZGVsVGFibGVOYW1lKSB7XG4gIGlmIChtb2RlbFRhYmxlTmFtZS5lbmRzV2l0aChcInNcIikpIHtcbiAgICByZXR1cm4gYCR7bW9kZWxUYWJsZU5hbWUuc2xpY2UoMCwgLTEpfV9hdWRpdHNgXG4gIH1cblxuICByZXR1cm4gYCR7bW9kZWxUYWJsZU5hbWV9X2F1ZGl0c2Bcbn1cbiJdfQ==