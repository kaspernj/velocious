// @ts-check
import MigrationsLedger from "../migrations-ledger.js";
import TableData from "../table-data/index.js";
import TableIndex from "../table-data/table-index.js";
const SIMPLE_DEFAULT_PATTERN = /^(?:-?\d+(?:\.\d+)?|[A-Za-z0-9 _.,:/@+-]*)$/;
/** @type {Record<string, number>} */
const TEXT_TYPE_RANKS = {
    tinytext: 1,
    text: 2,
    mediumtext: 3,
    longtext: 4
};
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
    /**
     * Creates a cloner that copies table structure from `sourceDb` into `targetDb`.
     * @param {{sourceDb: import("../drivers/base.js").default, targetDb: import("../drivers/base.js").default}} args - Databases to clone structure from and into.
     */
    constructor({ sourceDb, targetDb }) {
        this.sourceDb = sourceDb;
        this.targetDb = targetDb;
    }
    /**
     * Clones every given table from the source into the target, then baselines the
     * target's ledger so the cloned schema is recorded as already-migrated.
     * @param {string[]} tableNames - Source tables whose structure should be cloned.
     * @returns {Promise<void>}
     */
    async syncTables(tableNames) {
        for (const tableName of tableNames) {
            await this.syncTable(tableName);
        }
        await this.reconcileLedger();
    }
    /**
     * Clones a single table from the source into the target, creating it or adding and
     * widening columns and indexes as needed.
     * @param {string} tableName - Source table to synchronize with the target.
     * @returns {Promise<void>}
     */
    async syncTable(tableName) {
        const sourceTable = await this.sourceDb.getTableByName(tableName);
        if (!sourceTable) {
            throw new Error(`Expected source table to exist: ${tableName}`);
        }
        if (!await this.targetDb.tableExists(tableName)) {
            await this.createTargetTable({ sourceTable, tableName });
            return;
        }
        const changedColumns = await this.ensureTargetColumns({ sourceTable, tableName });
        if (changedColumns) {
            this.targetDb.clearSchemaCache();
        }
        await this.ensureTargetIndexes({ sourceTable, tableName });
    }
    /**
     * Creates the table in the target from the source table's columns and its
     * non-primary-key indexes.
     * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args - Source table metadata and target table name.
     * @returns {Promise<void>}
     */
    async createTargetTable({ sourceTable, tableName }) {
        const tableData = new TableData(tableName);
        for (const sourceColumn of await sourceTable.getColumns()) {
            tableData.addColumn(sourceColumn.getName(), this.columnArgsFromSourceColumn(sourceColumn, { isNewColumn: false }));
        }
        for (const sourceIndex of await sourceTable.getIndexes()) {
            if (!sourceIndex.isPrimaryKey()) {
                tableData.addIndex(this.tableDataIndexFromSourceIndex(sourceIndex));
            }
        }
        await this.targetDb.createTable(tableData);
        this.targetDb.clearSchemaCache();
    }
    /**
     * Adds columns present on the source but missing from the target, and widens
     * too-narrow target text columns.
     * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args - Source table metadata and target table name.
     * @returns {Promise<boolean>} Whether any column was added or widened.
     */
    async ensureTargetColumns({ sourceTable, tableName }) {
        const sourceColumns = await sourceTable.getColumns();
        const targetTable = await this.targetDb.getTableByNameOrFail(tableName);
        const targetColumnsByName = new Map();
        const missingColumns = [];
        const columnsNeedingWidening = [];
        for (const targetColumn of await targetTable.getColumns()) {
            targetColumnsByName.set(targetColumn.getName(), targetColumn);
        }
        for (const sourceColumn of sourceColumns) {
            const targetColumn = targetColumnsByName.get(sourceColumn.getName());
            if (!targetColumn) {
                missingColumns.push(sourceColumn);
            }
            else if (this.columnNeedsWidening(sourceColumn, targetColumn)) {
                columnsNeedingWidening.push(sourceColumn);
            }
        }
        if (missingColumns.length <= 0 && columnsNeedingWidening.length <= 0) {
            return false;
        }
        const tableData = new TableData(tableName);
        for (const sourceColumn of missingColumns) {
            tableData.addColumn(sourceColumn.getName(), this.columnArgsFromSourceColumn(sourceColumn, { isNewColumn: true }));
        }
        for (const sourceColumn of columnsNeedingWidening) {
            tableData.addColumn(sourceColumn.getName(), this.columnArgsFromSourceColumn(sourceColumn, { isNewColumn: false }));
        }
        if (this.targetDb.getType() === "mysql") {
            const missingAutoIncrementColumnNames = new Set(missingColumns
                .filter((sourceColumn) => sourceColumn.getAutoIncrement())
                .map((sourceColumn) => sourceColumn.getName()));
            const targetIndexesByName = new Map((await targetTable.getIndexes()).map((targetIndex) => [targetIndex.getName(), targetIndex]));
            for (const sourceIndex of await sourceTable.getIndexes()) {
                if (!sourceIndex.isPrimaryKey() &&
                    sourceIndex.isUnique() &&
                    missingAutoIncrementColumnNames.has(sourceIndex.getColumnNames()[0])) {
                    const targetIndex = targetIndexesByName.get(sourceIndex.getName());
                    if (targetIndex) {
                        if (this.indexesMatch(sourceIndex, targetIndex))
                            continue;
                        this.assertSafeIndexReplacement({ sourceIndex, tableName, targetIndex });
                        await this.dropTargetIndex({ tableName, targetIndex });
                        targetIndexesByName.delete(targetIndex.getName());
                    }
                    tableData.addIndex(this.tableDataIndexFromSourceIndex(sourceIndex));
                }
            }
        }
        for (const alterSql of await this.targetDb.alterTableSQLs(tableData)) {
            await this.targetDb.query(alterSql);
        }
        return true;
    }
    /**
     * Creates non-primary-key indexes present on the source but missing from the target,
     * and replaces target indexes whose definition (columns or uniqueness) drifted from
     * the source.
     * @param {{sourceTable: import("../drivers/base-table.js").default, tableName: string}} args - Source table metadata and target table name.
     * @returns {Promise<void>}
     */
    async ensureTargetIndexes({ sourceTable, tableName }) {
        const targetTable = await this.targetDb.getTableByNameOrFail(tableName);
        /** @type {Map<string, import("../drivers/base-columns-index.js").default>} */
        const targetIndexesByName = new Map();
        const targetIndexSignatures = new Set();
        let dirty = false;
        for (const targetIndex of await targetTable.getIndexes()) {
            targetIndexesByName.set(targetIndex.getName(), targetIndex);
            targetIndexSignatures.add(this.indexSignature(targetIndex));
        }
        for (const sourceIndex of await sourceTable.getIndexes()) {
            if (sourceIndex.isPrimaryKey()) {
                continue;
            }
            const sourceIndexSignature = this.indexSignature(sourceIndex);
            // SQLite index names are unique per-database, not per-table, so match cloned
            // indexes by their column/uniqueness signature rather than their name.
            if (this.targetDb.getType() === "sqlite" && targetIndexSignatures.has(sourceIndexSignature)) {
                continue;
            }
            const targetIndex = this.targetDb.getType() === "sqlite" ? undefined : targetIndexesByName.get(sourceIndex.getName());
            if (targetIndex) {
                if (!this.indexesMatch(sourceIndex, targetIndex)) {
                    this.assertSafeIndexReplacement({ sourceIndex, tableName, targetIndex });
                    await this.dropTargetIndex({ tableName, targetIndex });
                    targetIndexesByName.delete(targetIndex.getName());
                    targetIndexSignatures.delete(this.indexSignature(targetIndex));
                }
                else {
                    continue;
                }
            }
            // Drop any target index that shares the source name but survived the
            // drift check above because the driver was skipped (SQLite).
            const sameNameTargetIndex = targetIndexesByName.get(sourceIndex.getName());
            if (sameNameTargetIndex) {
                await this.dropTargetIndex({ tableName, targetIndex: sameNameTargetIndex });
                targetIndexesByName.delete(sameNameTargetIndex.getName());
                targetIndexSignatures.delete(this.indexSignature(sameNameTargetIndex));
            }
            const createIndexSqls = await this.targetDb.createIndexSQLs(this.createIndexArgsFromSourceIndex({ sourceIndex, tableName }));
            for (const createIndexSql of createIndexSqls) {
                await this.targetDb.query(createIndexSql);
            }
            dirty = true;
            targetIndexSignatures.add(sourceIndexSignature);
        }
        if (dirty) {
            this.targetDb.clearSchemaCache();
        }
    }
    /**
     * Drops an index on the target database.
     * @param {{tableName: string, targetIndex: import("../drivers/base-columns-index.js").default}} args - Target table and index to remove.
     * @returns {Promise<void>}
     */
    async dropTargetIndex({ tableName, targetIndex }) {
        const dropSqls = await this.targetDb.removeIndexSQLs({ name: targetIndex.getName(), tableName });
        for (const sql of dropSqls) {
            await this.targetDb.query(sql);
        }
    }
    /**
     * Refuses index replacements that could fail after the existing index is dropped.
     * @param {{sourceIndex: import("../drivers/base-columns-index.js").default, tableName: string, targetIndex: import("../drivers/base-columns-index.js").default}} args - Source and target index definitions.
     * @returns {void}
     */
    assertSafeIndexReplacement({ sourceIndex, tableName, targetIndex }) {
        // Replacing a non-unique index with a unique one is unsafe because the
        // target may have duplicate values that will reject the new constraint.
        // The opposite direction is safe because non-unique indexes accept them.
        if (sourceIndex.isUnique() && !targetIndex.isUnique()) {
            throw new Error(`Schema clone index drift for ${tableName}.${sourceIndex.getName()}: cannot safely replace a non-unique index with a unique one.`);
        }
    }
    /**
     * Baselines the target ledger so the cloned schema is recorded as already-applied.
     * @returns {Promise<string[]>} The versions newly recorded on the target.
     */
    async reconcileLedger() {
        return await MigrationsLedger.baselineFromDatabase({ sourceDb: this.sourceDb, targetDb: this.targetDb });
    }
    /**
     * Whether the target ledger is missing any version applied on the source — i.e. the
     * target schema may have been advanced out of band without recording it.
     * @returns {Promise<boolean>} - Whether the target ledger differs from the source.
     */
    async ledgerDriftsFromSource() {
        if (!await MigrationsLedger.tableExists(this.targetDb)) {
            return true;
        }
        const sourceVersions = await MigrationsLedger.appliedVersions(this.sourceDb);
        const targetVersionSet = new Set(await MigrationsLedger.appliedVersions(this.targetDb));
        return sourceVersions.some((version) => !targetVersionSet.has(version));
    }
    /**
     * Maps a source index into a TableData index for table creation (SQLite omits the
     * index name so the driver can generate a unique one).
     * @param {import("../drivers/base-columns-index.js").default} sourceIndex - Source index definition.
     * @returns {TableIndex} - Framework-independent index definition.
     */
    tableDataIndexFromSourceIndex(sourceIndex) {
        /** @type {{name?: string, unique: boolean}} */
        const args = { unique: sourceIndex.isUnique() };
        // SQLite index names are unique per-database, not per-table, so let the driver
        // generate one; other drivers preserve the source index name. Build the TableIndex
        // directly (rather than via the driver's getTableDataIndex, which only MySQL and
        // SQLite implement) so cloning a PostgreSQL or MS-SQL source table works too.
        if (this.targetDb.getType() !== "sqlite") {
            args.name = sourceIndex.getName();
        }
        return new TableIndex(sourceIndex.getColumnNames(), args);
    }
    /**
     * Builds driver create-index args from a source index (the index name is omitted on
     * SQLite, where index names are unique per-database rather than per-table).
     * @param {{sourceIndex: import("../drivers/base-columns-index.js").default, tableName: string}} args - Source index and target table receiving it.
     * @returns {{columns: string[], name?: string, tableName: string, unique: boolean}} - Arguments for creating the target index.
     */
    createIndexArgsFromSourceIndex({ sourceIndex, tableName }) {
        /** @type {{columns: string[], name?: string, tableName: string, unique: boolean}} */
        const createIndexArgs = {
            columns: sourceIndex.getColumnNames(),
            tableName,
            unique: sourceIndex.isUnique()
        };
        if (this.targetDb.getType() !== "sqlite") {
            createIndexArgs.name = sourceIndex.getName();
        }
        return createIndexArgs;
    }
    /**
     * Whether two indexes have the same uniqueness and ordered column list.
     * @param {import("../drivers/base-columns-index.js").default} sourceIndex - Source index definition.
     * @param {import("../drivers/base-columns-index.js").default} targetIndex - Target index definition.
     * @returns {boolean} - Whether both indexes have the same shape.
     */
    indexesMatch(sourceIndex, targetIndex) {
        const sourceColumnNames = sourceIndex.getColumnNames();
        const targetColumnNames = targetIndex.getColumnNames();
        if (sourceIndex.isUnique() !== targetIndex.isUnique()) {
            return false;
        }
        if (sourceColumnNames.length !== targetColumnNames.length) {
            return false;
        }
        for (let columnIndex = 0; columnIndex < sourceColumnNames.length; columnIndex++) {
            if (sourceColumnNames[columnIndex] !== targetColumnNames[columnIndex]) {
                return false;
            }
        }
        return true;
    }
    /**
     * A stable signature for an index, used to match cloned indexes by shape.
     * @param {import("../drivers/base-columns-index.js").default} index - Index definition.
     * @returns {string} - Stable index-shape signature.
     */
    indexSignature(index) {
        return `${index.isUnique() ? "unique" : "index"}:${index.getColumnNames().join(",")}`;
    }
    /**
     * Normalizes a column type to its canonical lowercase form (`int` becomes `integer`).
     * @param {string} columnType - Database column type.
     * @returns {string} - Canonical lowercase column type.
     */
    normalizedColumnType(columnType) {
        const normalizedType = columnType.toLowerCase();
        if (normalizedType === "int") {
            return "integer";
        }
        return normalizedType;
    }
    /**
     * The widening rank of a text column type (0 when not a text type).
     * @param {string} columnType - Database column type.
     * @returns {number} - Text-type widening rank.
     */
    textTypeRank(columnType) {
        return TEXT_TYPE_RANKS[this.normalizedColumnType(columnType)] || 0;
    }
    /**
     * Whether the target's text column is narrower than the source's and must be widened.
     * @param {import("../drivers/base-column.js").default} sourceColumn - Source column definition.
     * @param {import("../drivers/base-column.js").default} targetColumn - Target column definition.
     * @returns {boolean} - Whether the target text column must be widened.
     */
    columnNeedsWidening(sourceColumn, targetColumn) {
        const sourceRank = this.textTypeRank(sourceColumn.getType());
        const targetRank = this.textTypeRank(targetColumn.getType());
        return sourceRank > 0 && targetRank > 0 && sourceRank > targetRank;
    }
    /**
     * Builds TableData column args from a source column, copying type, nullability,
     * length, notes, simple defaults and (for full clones) primary-key flag.
     * @param {import("../drivers/base-column.js").default} sourceColumn - Source column definition.
     * @param {{isNewColumn: boolean}} args - Whether the column is being added instead of cloned with its table.
     * @returns {Record<string, unknown>} - Arguments for altering the target column.
     */
    columnArgsFromSourceColumn(sourceColumn, { isNewColumn }) {
        /** @type {{autoIncrement?: boolean, default?: unknown, isNewColumn: boolean, maxLength?: number, notes?: string, null: boolean, primaryKey?: boolean, type: string}} */
        const columnArgs = {
            isNewColumn,
            null: sourceColumn.getNull(),
            type: this.normalizedColumnType(sourceColumn.getType())
        };
        const defaultValue = sourceColumn.getDefault();
        const maxLength = sourceColumn.getMaxLength();
        const notes = sourceColumn.getNotes();
        if (!isNewColumn && sourceColumn.getPrimaryKey()) {
            columnArgs.primaryKey = true;
        }
        if (sourceColumn.getAutoIncrement()) {
            columnArgs.autoIncrement = true;
        }
        // A maxLength of -1 is the MS-SQL "max" sentinel (NVARCHAR(MAX) / VARBINARY(MAX),
        // backing Velocious text/json/blob columns); the column type drives the unbounded
        // SQL, so don't forward -1 as an explicit length (it would emit NVARCHAR(-1)).
        if (maxLength !== undefined && maxLength >= 0) {
            columnArgs.maxLength = maxLength;
        }
        if (notes) {
            columnArgs.notes = notes;
        }
        if (defaultValue !== null && defaultValue !== undefined && SIMPLE_DEFAULT_PATTERN.test(String(defaultValue))) {
            columnArgs.default = defaultValue;
        }
        return columnArgs;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hLWNsb25lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS90ZW5hbnRzL3NjaGVtYS1jbG9uZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0seUJBQXlCLENBQUE7QUFDdEQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxVQUFVLE1BQU0sOEJBQThCLENBQUE7QUFFckQsTUFBTSxzQkFBc0IsR0FBRyw2Q0FBNkMsQ0FBQTtBQUU1RSxxQ0FBcUM7QUFDckMsTUFBTSxlQUFlLEdBQUc7SUFDdEIsUUFBUSxFQUFFLENBQUM7SUFDWCxJQUFJLEVBQUUsQ0FBQztJQUNQLFVBQVUsRUFBRSxDQUFDO0lBQ2IsUUFBUSxFQUFFLENBQUM7Q0FDWixDQUFBO0FBRUQ7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBWTtJQUMvQjs7O09BR0c7SUFDSCxZQUFZLEVBQUMsUUFBUSxFQUFFLFFBQVEsRUFBQztRQUM5QixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUN4QixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLFVBQVU7UUFDekIsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDakMsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUztRQUN2QixNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FB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blxuaW1wb3J0IE1pZ3JhdGlvbnNMZWRnZXIgZnJvbSBcIi4uL21pZ3JhdGlvbnMtbGVkZ2VyLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlSW5kZXggZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtaW5kZXguanNcIlxuXG5jb25zdCBTSU1QTEVfREVGQVVMVF9QQVRURVJOID0gL14oPzotP1xcZCsoPzpcXC5cXGQrKT98W0EtWmEtejAtOSBfLiw6L0ArLV0qKSQvXG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbmNvbnN0IFRFWFRfVFlQRV9SQU5LUyA9IHtcbiAgdGlueXRleHQ6IDEsXG4gIHRleHQ6IDIsXG4gIG1lZGl1bXRleHQ6IDMsXG4gIGxvbmd0ZXh0OiA0XG59XG5cbi8qKlxuICogQ2xvbmVzIHRhYmxlIHN0cnVjdHVyZSAoY29sdW1ucywgdGV4dC10eXBlIHdpZGVuaW5nLCBpbmRleGVzKSBmcm9tIGEgc291cmNlIGRhdGFiYXNlXG4gKiBpbnRvIGEgdGFyZ2V0IGRhdGFiYXNlIGZvciBhIGdpdmVuIHNldCBvZiB0YWJsZXMsIHRoZW4gYmFzZWxpbmVzIHRoZSB0YXJnZXQnc1xuICogYHNjaGVtYV9taWdyYXRpb25zYCBsZWRnZXIgdG8gdGhlIHNvdXJjZSB2aWEge0BsaW5rIE1pZ3JhdGlvbnNMZWRnZXJ9LiBUaGlzIGlzIHRoZVxuICogbWVjaGFuaXNtIG11bHRpLXRlbmFudCBhcHBzIHVzZSB0byBwcm92aXNpb24gYSB0ZW5hbnQgZGF0YWJhc2UgZnJvbSBhIHRlbXBsYXRlL2dsb2JhbFxuICogZGF0YWJhc2Ugd2l0aG91dCByZS1ydW5uaW5nIG1pZ3JhdGlvbnM6IHRoZSBzdHJ1Y3R1cmUgaXMgY29waWVkIGFuZCB0aGUgbGVkZ2VyIGlzXG4gKiByZWNvcmRlZCBhcyBhbHJlYWR5LWFwcGxpZWQsIHNvIGEgbGF0ZXIgYGRiOnRlbmFudHM6bWlncmF0ZWAgZG9lcyBub3QgcmUtcnVuIGFuXG4gKiBgYWRkQ29sdW1uYCB3aG9zZSBjb2x1bW4gYWxyZWFkeSBleGlzdHMuXG4gKlxuICogVGhlIGNsb25lciBpcyBpbnRlbnRpb25hbGx5IHBvbGljeS1mcmVlIOKAlCB0aGUgY2FsbGVyIGRlY2lkZXMgd2hpY2ggdGFibGVzIHRvIHN5bmMgYW5kXG4gKiB3aGljaCBkYXRhYmFzZXMgYXJlIHNvdXJjZS90YXJnZXQuIEl0IGlzIGlkZW1wb3RlbnQ6IG1pc3NpbmcgdGFibGVzIGFyZSBjcmVhdGVkLFxuICogbWlzc2luZyBjb2x1bW5zIGFkZGVkLCB0b28tbmFycm93IHRleHQgY29sdW1ucyB3aWRlbmVkLCBhbmQgbWlzc2luZyBpbmRleGVzIGNyZWF0ZWQ7XG4gKiBhbiBpbmRleCB3aG9zZSBkZWZpbml0aW9uIGRpdmVyZ2VzIGZyb20gdGhlIHNvdXJjZSBpcyB0cmVhdGVkIGFzIGRyaWZ0IGFuZCB0aHJvd3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNjaGVtYUNsb25lciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgY2xvbmVyIHRoYXQgY29waWVzIHRhYmxlIHN0cnVjdHVyZSBmcm9tIGBzb3VyY2VEYmAgaW50byBgdGFyZ2V0RGJgLlxuICAgKiBAcGFyYW0ge3tzb3VyY2VEYjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHRhcmdldERiOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19IGFyZ3MgLSBEYXRhYmFzZXMgdG8gY2xvbmUgc3RydWN0dXJlIGZyb20gYW5kIGludG8uXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7c291cmNlRGIsIHRhcmdldERifSkge1xuICAgIHRoaXMuc291cmNlRGIgPSBzb3VyY2VEYlxuICAgIHRoaXMudGFyZ2V0RGIgPSB0YXJnZXREYlxuICB9XG5cbiAgLyoqXG4gICAqIENsb25lcyBldmVyeSBnaXZlbiB0YWJsZSBmcm9tIHRoZSBzb3VyY2UgaW50byB0aGUgdGFyZ2V0LCB0aGVuIGJhc2VsaW5lcyB0aGVcbiAgICogdGFyZ2V0J3MgbGVkZ2VyIHNvIHRoZSBjbG9uZWQgc2NoZW1hIGlzIHJlY29yZGVkIGFzIGFscmVhZHktbWlncmF0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHRhYmxlTmFtZXMgLSBTb3VyY2UgdGFibGVzIHdob3NlIHN0cnVjdHVyZSBzaG91bGQgYmUgY2xvbmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN5bmNUYWJsZXModGFibGVOYW1lcykge1xuICAgIGZvciAoY29uc3QgdGFibGVOYW1lIG9mIHRhYmxlTmFtZXMpIHtcbiAgICAgIGF3YWl0IHRoaXMuc3luY1RhYmxlKHRhYmxlTmFtZSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlY29uY2lsZUxlZGdlcigpXG4gIH1cblxuICAvKipcbiAgICogQ2xvbmVzIGEgc2luZ2xlIHRhYmxlIGZyb20gdGhlIHNvdXJjZSBpbnRvIHRoZSB0YXJnZXQsIGNyZWF0aW5nIGl0IG9yIGFkZGluZyBhbmRcbiAgICogd2lkZW5pbmcgY29sdW1ucyBhbmQgaW5kZXhlcyBhcyBuZWVkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBTb3VyY2UgdGFibGUgdG8gc3luY2hyb25pemUgd2l0aCB0aGUgdGFyZ2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHN5bmNUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCBzb3VyY2VUYWJsZSA9IGF3YWl0IHRoaXMuc291cmNlRGIuZ2V0VGFibGVCeU5hbWUodGFibGVOYW1lKVxuXG4gICAgaWYgKCFzb3VyY2VUYWJsZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBzb3VyY2UgdGFibGUgdG8gZXhpc3Q6ICR7dGFibGVOYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFhd2FpdCB0aGlzLnRhcmdldERiLnRhYmxlRXhpc3RzKHRhYmxlTmFtZSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlVGFyZ2V0VGFibGUoe3NvdXJjZVRhYmxlLCB0YWJsZU5hbWV9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2hhbmdlZENvbHVtbnMgPSBhd2FpdCB0aGlzLmVuc3VyZVRhcmdldENvbHVtbnMoe3NvdXJjZVRhYmxlLCB0YWJsZU5hbWV9KVxuXG4gICAgaWYgKGNoYW5nZWRDb2x1bW5zKSB7XG4gICAgICB0aGlzLnRhcmdldERiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlVGFyZ2V0SW5kZXhlcyh7c291cmNlVGFibGUsIHRhYmxlTmFtZX0pXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgdGFibGUgaW4gdGhlIHRhcmdldCBmcm9tIHRoZSBzb3VyY2UgdGFibGUncyBjb2x1bW5zIGFuZCBpdHNcbiAgICogbm9uLXByaW1hcnkta2V5IGluZGV4ZXMuXG4gICAqIEBwYXJhbSB7e3NvdXJjZVRhYmxlOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCwgdGFibGVOYW1lOiBzdHJpbmd9fSBhcmdzIC0gU291cmNlIHRhYmxlIG1ldGFkYXRhIGFuZCB0YXJnZXQgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjcmVhdGVUYXJnZXRUYWJsZSh7c291cmNlVGFibGUsIHRhYmxlTmFtZX0pIHtcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIGZvciAoY29uc3Qgc291cmNlQ29sdW1uIG9mIGF3YWl0IHNvdXJjZVRhYmxlLmdldENvbHVtbnMoKSkge1xuICAgICAgdGFibGVEYXRhLmFkZENvbHVtbihzb3VyY2VDb2x1bW4uZ2V0TmFtZSgpLCB0aGlzLmNvbHVtbkFyZ3NGcm9tU291cmNlQ29sdW1uKHNvdXJjZUNvbHVtbiwge2lzTmV3Q29sdW1uOiBmYWxzZX0pKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc291cmNlSW5kZXggb2YgYXdhaXQgc291cmNlVGFibGUuZ2V0SW5kZXhlcygpKSB7XG4gICAgICBpZiAoIXNvdXJjZUluZGV4LmlzUHJpbWFyeUtleSgpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5hZGRJbmRleCh0aGlzLnRhYmxlRGF0YUluZGV4RnJvbVNvdXJjZUluZGV4KHNvdXJjZUluZGV4KSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnRhcmdldERiLmNyZWF0ZVRhYmxlKHRhYmxlRGF0YSlcbiAgICB0aGlzLnRhcmdldERiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgY29sdW1ucyBwcmVzZW50IG9uIHRoZSBzb3VyY2UgYnV0IG1pc3NpbmcgZnJvbSB0aGUgdGFyZ2V0LCBhbmQgd2lkZW5zXG4gICAqIHRvby1uYXJyb3cgdGFyZ2V0IHRleHQgY29sdW1ucy5cbiAgICogQHBhcmFtIHt7c291cmNlVGFibGU6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0LCB0YWJsZU5hbWU6IHN0cmluZ319IGFyZ3MgLSBTb3VyY2UgdGFibGUgbWV0YWRhdGEgYW5kIHRhcmdldCB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciBhbnkgY29sdW1uIHdhcyBhZGRlZCBvciB3aWRlbmVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlVGFyZ2V0Q29sdW1ucyh7c291cmNlVGFibGUsIHRhYmxlTmFtZX0pIHtcbiAgICBjb25zdCBzb3VyY2VDb2x1bW5zID0gYXdhaXQgc291cmNlVGFibGUuZ2V0Q29sdW1ucygpXG4gICAgY29uc3QgdGFyZ2V0VGFibGUgPSBhd2FpdCB0aGlzLnRhcmdldERiLmdldFRhYmxlQnlOYW1lT3JGYWlsKHRhYmxlTmFtZSlcbiAgICBjb25zdCB0YXJnZXRDb2x1bW5zQnlOYW1lID0gbmV3IE1hcCgpXG4gICAgY29uc3QgbWlzc2luZ0NvbHVtbnMgPSBbXVxuICAgIGNvbnN0IGNvbHVtbnNOZWVkaW5nV2lkZW5pbmcgPSBbXVxuXG4gICAgZm9yIChjb25zdCB0YXJnZXRDb2x1bW4gb2YgYXdhaXQgdGFyZ2V0VGFibGUuZ2V0Q29sdW1ucygpKSB7XG4gICAgICB0YXJnZXRDb2x1bW5zQnlOYW1lLnNldCh0YXJnZXRDb2x1bW4uZ2V0TmFtZSgpLCB0YXJnZXRDb2x1bW4pXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VDb2x1bW4gb2Ygc291cmNlQ29sdW1ucykge1xuICAgICAgY29uc3QgdGFyZ2V0Q29sdW1uID0gdGFyZ2V0Q29sdW1uc0J5TmFtZS5nZXQoc291cmNlQ29sdW1uLmdldE5hbWUoKSlcblxuICAgICAgaWYgKCF0YXJnZXRDb2x1bW4pIHtcbiAgICAgICAgbWlzc2luZ0NvbHVtbnMucHVzaChzb3VyY2VDb2x1bW4pXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuY29sdW1uTmVlZHNXaWRlbmluZyhzb3VyY2VDb2x1bW4sIHRhcmdldENvbHVtbikpIHtcbiAgICAgICAgY29sdW1uc05lZWRpbmdXaWRlbmluZy5wdXNoKHNvdXJjZUNvbHVtbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobWlzc2luZ0NvbHVtbnMubGVuZ3RoIDw9IDAgJiYgY29sdW1uc05lZWRpbmdXaWRlbmluZy5sZW5ndGggPD0gMCkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUpXG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZUNvbHVtbiBvZiBtaXNzaW5nQ29sdW1ucykge1xuICAgICAgdGFibGVEYXRhLmFkZENvbHVtbihzb3VyY2VDb2x1bW4uZ2V0TmFtZSgpLCB0aGlzLmNvbHVtbkFyZ3NGcm9tU291cmNlQ29sdW1uKHNvdXJjZUNvbHVtbiwge2lzTmV3Q29sdW1uOiB0cnVlfSkpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzb3VyY2VDb2x1bW4gb2YgY29sdW1uc05lZWRpbmdXaWRlbmluZykge1xuICAgICAgdGFibGVEYXRhLmFkZENvbHVtbihzb3VyY2VDb2x1bW4uZ2V0TmFtZSgpLCB0aGlzLmNvbHVtbkFyZ3NGcm9tU291cmNlQ29sdW1uKHNvdXJjZUNvbHVtbiwge2lzTmV3Q29sdW1uOiBmYWxzZX0pKVxuICAgIH1cblxuICAgIGlmICh0aGlzLnRhcmdldERiLmdldFR5cGUoKSA9PT0gXCJteXNxbFwiKSB7XG4gICAgICBjb25zdCBtaXNzaW5nQXV0b0luY3JlbWVudENvbHVtbk5hbWVzID0gbmV3IFNldChcbiAgICAgICAgbWlzc2luZ0NvbHVtbnNcbiAgICAgICAgICAuZmlsdGVyKChzb3VyY2VDb2x1bW4pID0+IHNvdXJjZUNvbHVtbi5nZXRBdXRvSW5jcmVtZW50KCkpXG4gICAgICAgICAgLm1hcCgoc291cmNlQ29sdW1uKSA9PiBzb3VyY2VDb2x1bW4uZ2V0TmFtZSgpKVxuICAgICAgKVxuICAgICAgY29uc3QgdGFyZ2V0SW5kZXhlc0J5TmFtZSA9IG5ldyBNYXAoXG4gICAgICAgIChhd2FpdCB0YXJnZXRUYWJsZS5nZXRJbmRleGVzKCkpLm1hcCgodGFyZ2V0SW5kZXgpID0+IFt0YXJnZXRJbmRleC5nZXROYW1lKCksIHRhcmdldEluZGV4XSlcbiAgICAgIClcblxuICAgICAgZm9yIChjb25zdCBzb3VyY2VJbmRleCBvZiBhd2FpdCBzb3VyY2VUYWJsZS5nZXRJbmRleGVzKCkpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICFzb3VyY2VJbmRleC5pc1ByaW1hcnlLZXkoKSAmJlxuICAgICAgICAgIHNvdXJjZUluZGV4LmlzVW5pcXVlKCkgJiZcbiAgICAgICAgICBtaXNzaW5nQXV0b0luY3JlbWVudENvbHVtbk5hbWVzLmhhcyhzb3VyY2VJbmRleC5nZXRDb2x1bW5OYW1lcygpWzBdKVxuICAgICAgICApIHtcbiAgICAgICAgICBjb25zdCB0YXJnZXRJbmRleCA9IHRhcmdldEluZGV4ZXNCeU5hbWUuZ2V0KHNvdXJjZUluZGV4LmdldE5hbWUoKSlcblxuICAgICAgICAgIGlmICh0YXJnZXRJbmRleCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuaW5kZXhlc01hdGNoKHNvdXJjZUluZGV4LCB0YXJnZXRJbmRleCkpIGNvbnRpbnVlXG5cbiAgICAgICAgICAgIHRoaXMuYXNzZXJ0U2FmZUluZGV4UmVwbGFjZW1lbnQoe3NvdXJjZUluZGV4LCB0YWJsZU5hbWUsIHRhcmdldEluZGV4fSlcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZHJvcFRhcmdldEluZGV4KHt0YWJsZU5hbWUsIHRhcmdldEluZGV4fSlcbiAgICAgICAgICAgIHRhcmdldEluZGV4ZXNCeU5hbWUuZGVsZXRlKHRhcmdldEluZGV4LmdldE5hbWUoKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0YWJsZURhdGEuYWRkSW5kZXgodGhpcy50YWJsZURhdGFJbmRleEZyb21Tb3VyY2VJbmRleChzb3VyY2VJbmRleCkpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGFsdGVyU3FsIG9mIGF3YWl0IHRoaXMudGFyZ2V0RGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkge1xuICAgICAgYXdhaXQgdGhpcy50YXJnZXREYi5xdWVyeShhbHRlclNxbClcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgbm9uLXByaW1hcnkta2V5IGluZGV4ZXMgcHJlc2VudCBvbiB0aGUgc291cmNlIGJ1dCBtaXNzaW5nIGZyb20gdGhlIHRhcmdldCxcbiAgICogYW5kIHJlcGxhY2VzIHRhcmdldCBpbmRleGVzIHdob3NlIGRlZmluaXRpb24gKGNvbHVtbnMgb3IgdW5pcXVlbmVzcykgZHJpZnRlZCBmcm9tXG4gICAqIHRoZSBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e3NvdXJjZVRhYmxlOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCwgdGFibGVOYW1lOiBzdHJpbmd9fSBhcmdzIC0gU291cmNlIHRhYmxlIG1ldGFkYXRhIGFuZCB0YXJnZXQgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBlbnN1cmVUYXJnZXRJbmRleGVzKHtzb3VyY2VUYWJsZSwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHRhcmdldFRhYmxlID0gYXdhaXQgdGhpcy50YXJnZXREYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbCh0YWJsZU5hbWUpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1ucy1pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCB0YXJnZXRJbmRleGVzQnlOYW1lID0gbmV3IE1hcCgpXG4gICAgY29uc3QgdGFyZ2V0SW5kZXhTaWduYXR1cmVzID0gbmV3IFNldCgpXG4gICAgbGV0IGRpcnR5ID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgdGFyZ2V0SW5kZXggb2YgYXdhaXQgdGFyZ2V0VGFibGUuZ2V0SW5kZXhlcygpKSB7XG4gICAgICB0YXJnZXRJbmRleGVzQnlOYW1lLnNldCh0YXJnZXRJbmRleC5nZXROYW1lKCksIHRhcmdldEluZGV4KVxuICAgICAgdGFyZ2V0SW5kZXhTaWduYXR1cmVzLmFkZCh0aGlzLmluZGV4U2lnbmF0dXJlKHRhcmdldEluZGV4KSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZUluZGV4IG9mIGF3YWl0IHNvdXJjZVRhYmxlLmdldEluZGV4ZXMoKSkge1xuICAgICAgaWYgKHNvdXJjZUluZGV4LmlzUHJpbWFyeUtleSgpKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZUluZGV4U2lnbmF0dXJlID0gdGhpcy5pbmRleFNpZ25hdHVyZShzb3VyY2VJbmRleClcblxuICAgICAgLy8gU1FMaXRlIGluZGV4IG5hbWVzIGFyZSB1bmlxdWUgcGVyLWRhdGFiYXNlLCBub3QgcGVyLXRhYmxlLCBzbyBtYXRjaCBjbG9uZWRcbiAgICAgIC8vIGluZGV4ZXMgYnkgdGhlaXIgY29sdW1uL3VuaXF1ZW5lc3Mgc2lnbmF0dXJlIHJhdGhlciB0aGFuIHRoZWlyIG5hbWUuXG4gICAgICBpZiAodGhpcy50YXJnZXREYi5nZXRUeXBlKCkgPT09IFwic3FsaXRlXCIgJiYgdGFyZ2V0SW5kZXhTaWduYXR1cmVzLmhhcyhzb3VyY2VJbmRleFNpZ25hdHVyZSkpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0SW5kZXggPSB0aGlzLnRhcmdldERiLmdldFR5cGUoKSA9PT0gXCJzcWxpdGVcIiA/IHVuZGVmaW5lZCA6IHRhcmdldEluZGV4ZXNCeU5hbWUuZ2V0KHNvdXJjZUluZGV4LmdldE5hbWUoKSlcblxuICAgICAgaWYgKHRhcmdldEluZGV4KSB7XG4gICAgICAgIGlmICghdGhpcy5pbmRleGVzTWF0Y2goc291cmNlSW5kZXgsIHRhcmdldEluZGV4KSkge1xuICAgICAgICAgIHRoaXMuYXNzZXJ0U2FmZUluZGV4UmVwbGFjZW1lbnQoe3NvdXJjZUluZGV4LCB0YWJsZU5hbWUsIHRhcmdldEluZGV4fSlcbiAgICAgICAgICBhd2FpdCB0aGlzLmRyb3BUYXJnZXRJbmRleCh7dGFibGVOYW1lLCB0YXJnZXRJbmRleH0pXG4gICAgICAgICAgdGFyZ2V0SW5kZXhlc0J5TmFtZS5kZWxldGUodGFyZ2V0SW5kZXguZ2V0TmFtZSgpKVxuICAgICAgICAgIHRhcmdldEluZGV4U2lnbmF0dXJlcy5kZWxldGUodGhpcy5pbmRleFNpZ25hdHVyZSh0YXJnZXRJbmRleCkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBEcm9wIGFueSB0YXJnZXQgaW5kZXggdGhhdCBzaGFyZXMgdGhlIHNvdXJjZSBuYW1lIGJ1dCBzdXJ2aXZlZCB0aGVcbiAgICAgIC8vIGRyaWZ0IGNoZWNrIGFib3ZlIGJlY2F1c2UgdGhlIGRyaXZlciB3YXMgc2tpcHBlZCAoU1FMaXRlKS5cbiAgICAgIGNvbnN0IHNhbWVOYW1lVGFyZ2V0SW5kZXggPSB0YXJnZXRJbmRleGVzQnlOYW1lLmdldChzb3VyY2VJbmRleC5nZXROYW1lKCkpXG5cbiAgICAgIGlmIChzYW1lTmFtZVRhcmdldEluZGV4KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZHJvcFRhcmdldEluZGV4KHt0YWJsZU5hbWUsIHRhcmdldEluZGV4OiBzYW1lTmFtZVRhcmdldEluZGV4fSlcbiAgICAgICAgdGFyZ2V0SW5kZXhlc0J5TmFtZS5kZWxldGUoc2FtZU5hbWVUYXJnZXRJbmRleC5nZXROYW1lKCkpXG4gICAgICAgIHRhcmdldEluZGV4U2lnbmF0dXJlcy5kZWxldGUodGhpcy5pbmRleFNpZ25hdHVyZShzYW1lTmFtZVRhcmdldEluZGV4KSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgY3JlYXRlSW5kZXhTcWxzID0gYXdhaXQgdGhpcy50YXJnZXREYi5jcmVhdGVJbmRleFNRTHModGhpcy5jcmVhdGVJbmRleEFyZ3NGcm9tU291cmNlSW5kZXgoe3NvdXJjZUluZGV4LCB0YWJsZU5hbWV9KSlcblxuICAgICAgZm9yIChjb25zdCBjcmVhdGVJbmRleFNxbCBvZiBjcmVhdGVJbmRleFNxbHMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy50YXJnZXREYi5xdWVyeShjcmVhdGVJbmRleFNxbClcbiAgICAgIH1cblxuICAgICAgZGlydHkgPSB0cnVlXG4gICAgICB0YXJnZXRJbmRleFNpZ25hdHVyZXMuYWRkKHNvdXJjZUluZGV4U2lnbmF0dXJlKVxuICAgIH1cblxuICAgIGlmIChkaXJ0eSkge1xuICAgICAgdGhpcy50YXJnZXREYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRHJvcHMgYW4gaW5kZXggb24gdGhlIHRhcmdldCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHt7dGFibGVOYW1lOiBzdHJpbmcsIHRhcmdldEluZGV4OiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1ucy1pbmRleC5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIFRhcmdldCB0YWJsZSBhbmQgaW5kZXggdG8gcmVtb3ZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGRyb3BUYXJnZXRJbmRleCh7dGFibGVOYW1lLCB0YXJnZXRJbmRleH0pIHtcbiAgICBjb25zdCBkcm9wU3FscyA9IGF3YWl0IHRoaXMudGFyZ2V0RGIucmVtb3ZlSW5kZXhTUUxzKHtuYW1lOiB0YXJnZXRJbmRleC5nZXROYW1lKCksIHRhYmxlTmFtZX0pXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBkcm9wU3Fscykge1xuICAgICAgYXdhaXQgdGhpcy50YXJnZXREYi5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZnVzZXMgaW5kZXggcmVwbGFjZW1lbnRzIHRoYXQgY291bGQgZmFpbCBhZnRlciB0aGUgZXhpc3RpbmcgaW5kZXggaXMgZHJvcHBlZC5cbiAgICogQHBhcmFtIHt7c291cmNlSW5kZXg6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHQsIHRhYmxlTmFtZTogc3RyaW5nLCB0YXJnZXRJbmRleDogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbnMtaW5kZXguanNcIikuZGVmYXVsdH19IGFyZ3MgLSBTb3VyY2UgYW5kIHRhcmdldCBpbmRleCBkZWZpbml0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRTYWZlSW5kZXhSZXBsYWNlbWVudCh7c291cmNlSW5kZXgsIHRhYmxlTmFtZSwgdGFyZ2V0SW5kZXh9KSB7XG4gICAgLy8gUmVwbGFjaW5nIGEgbm9uLXVuaXF1ZSBpbmRleCB3aXRoIGEgdW5pcXVlIG9uZSBpcyB1bnNhZmUgYmVjYXVzZSB0aGVcbiAgICAvLyB0YXJnZXQgbWF5IGhhdmUgZHVwbGljYXRlIHZhbHVlcyB0aGF0IHdpbGwgcmVqZWN0IHRoZSBuZXcgY29uc3RyYWludC5cbiAgICAvLyBUaGUgb3Bwb3NpdGUgZGlyZWN0aW9uIGlzIHNhZmUgYmVjYXVzZSBub24tdW5pcXVlIGluZGV4ZXMgYWNjZXB0IHRoZW0uXG4gICAgaWYgKHNvdXJjZUluZGV4LmlzVW5pcXVlKCkgJiYgIXRhcmdldEluZGV4LmlzVW5pcXVlKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2NoZW1hIGNsb25lIGluZGV4IGRyaWZ0IGZvciAke3RhYmxlTmFtZX0uJHtzb3VyY2VJbmRleC5nZXROYW1lKCl9OiBjYW5ub3Qgc2FmZWx5IHJlcGxhY2UgYSBub24tdW5pcXVlIGluZGV4IHdpdGggYSB1bmlxdWUgb25lLmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJhc2VsaW5lcyB0aGUgdGFyZ2V0IGxlZGdlciBzbyB0aGUgY2xvbmVkIHNjaGVtYSBpcyByZWNvcmRlZCBhcyBhbHJlYWR5LWFwcGxpZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gVGhlIHZlcnNpb25zIG5ld2x5IHJlY29yZGVkIG9uIHRoZSB0YXJnZXQuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVMZWRnZXIoKSB7XG4gICAgcmV0dXJuIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYmFzZWxpbmVGcm9tRGF0YWJhc2Uoe3NvdXJjZURiOiB0aGlzLnNvdXJjZURiLCB0YXJnZXREYjogdGhpcy50YXJnZXREYn0pXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgdGFyZ2V0IGxlZGdlciBpcyBtaXNzaW5nIGFueSB2ZXJzaW9uIGFwcGxpZWQgb24gdGhlIHNvdXJjZSDigJQgaS5lLiB0aGVcbiAgICogdGFyZ2V0IHNjaGVtYSBtYXkgaGF2ZSBiZWVuIGFkdmFuY2VkIG91dCBvZiBiYW5kIHdpdGhvdXQgcmVjb3JkaW5nIGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSB0YXJnZXQgbGVkZ2VyIGRpZmZlcnMgZnJvbSB0aGUgc291cmNlLlxuICAgKi9cbiAgYXN5bmMgbGVkZ2VyRHJpZnRzRnJvbVNvdXJjZSgpIHtcbiAgICBpZiAoIWF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIudGFibGVFeGlzdHModGhpcy50YXJnZXREYikpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlVmVyc2lvbnMgPSBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmFwcGxpZWRWZXJzaW9ucyh0aGlzLnNvdXJjZURiKVxuICAgIGNvbnN0IHRhcmdldFZlcnNpb25TZXQgPSBuZXcgU2V0KGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYXBwbGllZFZlcnNpb25zKHRoaXMudGFyZ2V0RGIpKVxuXG4gICAgcmV0dXJuIHNvdXJjZVZlcnNpb25zLnNvbWUoKHZlcnNpb24pID0+ICF0YXJnZXRWZXJzaW9uU2V0Lmhhcyh2ZXJzaW9uKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgc291cmNlIGluZGV4IGludG8gYSBUYWJsZURhdGEgaW5kZXggZm9yIHRhYmxlIGNyZWF0aW9uIChTUUxpdGUgb21pdHMgdGhlXG4gICAqIGluZGV4IG5hbWUgc28gdGhlIGRyaXZlciBjYW4gZ2VuZXJhdGUgYSB1bmlxdWUgb25lKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1ucy1pbmRleC5qc1wiKS5kZWZhdWx0fSBzb3VyY2VJbmRleCAtIFNvdXJjZSBpbmRleCBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7VGFibGVJbmRleH0gLSBGcmFtZXdvcmstaW5kZXBlbmRlbnQgaW5kZXggZGVmaW5pdGlvbi5cbiAgICovXG4gIHRhYmxlRGF0YUluZGV4RnJvbVNvdXJjZUluZGV4KHNvdXJjZUluZGV4KSB7XG4gICAgLyoqIEB0eXBlIHt7bmFtZT86IHN0cmluZywgdW5pcXVlOiBib29sZWFufX0gKi9cbiAgICBjb25zdCBhcmdzID0ge3VuaXF1ZTogc291cmNlSW5kZXguaXNVbmlxdWUoKX1cblxuICAgIC8vIFNRTGl0ZSBpbmRleCBuYW1lcyBhcmUgdW5pcXVlIHBlci1kYXRhYmFzZSwgbm90IHBlci10YWJsZSwgc28gbGV0IHRoZSBkcml2ZXJcbiAgICAvLyBnZW5lcmF0ZSBvbmU7IG90aGVyIGRyaXZlcnMgcHJlc2VydmUgdGhlIHNvdXJjZSBpbmRleCBuYW1lLiBCdWlsZCB0aGUgVGFibGVJbmRleFxuICAgIC8vIGRpcmVjdGx5IChyYXRoZXIgdGhhbiB2aWEgdGhlIGRyaXZlcidzIGdldFRhYmxlRGF0YUluZGV4LCB3aGljaCBvbmx5IE15U1FMIGFuZFxuICAgIC8vIFNRTGl0ZSBpbXBsZW1lbnQpIHNvIGNsb25pbmcgYSBQb3N0Z3JlU1FMIG9yIE1TLVNRTCBzb3VyY2UgdGFibGUgd29ya3MgdG9vLlxuICAgIGlmICh0aGlzLnRhcmdldERiLmdldFR5cGUoKSAhPT0gXCJzcWxpdGVcIikge1xuICAgICAgYXJncy5uYW1lID0gc291cmNlSW5kZXguZ2V0TmFtZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBUYWJsZUluZGV4KHNvdXJjZUluZGV4LmdldENvbHVtbk5hbWVzKCksIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGRyaXZlciBjcmVhdGUtaW5kZXggYXJncyBmcm9tIGEgc291cmNlIGluZGV4ICh0aGUgaW5kZXggbmFtZSBpcyBvbWl0dGVkIG9uXG4gICAqIFNRTGl0ZSwgd2hlcmUgaW5kZXggbmFtZXMgYXJlIHVuaXF1ZSBwZXItZGF0YWJhc2UgcmF0aGVyIHRoYW4gcGVyLXRhYmxlKS5cbiAgICogQHBhcmFtIHt7c291cmNlSW5kZXg6IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHQsIHRhYmxlTmFtZTogc3RyaW5nfX0gYXJncyAtIFNvdXJjZSBpbmRleCBhbmQgdGFyZ2V0IHRhYmxlIHJlY2VpdmluZyBpdC5cbiAgICogQHJldHVybnMge3tjb2x1bW5zOiBzdHJpbmdbXSwgbmFtZT86IHN0cmluZywgdGFibGVOYW1lOiBzdHJpbmcsIHVuaXF1ZTogYm9vbGVhbn19IC0gQXJndW1lbnRzIGZvciBjcmVhdGluZyB0aGUgdGFyZ2V0IGluZGV4LlxuICAgKi9cbiAgY3JlYXRlSW5kZXhBcmdzRnJvbVNvdXJjZUluZGV4KHtzb3VyY2VJbmRleCwgdGFibGVOYW1lfSkge1xuICAgIC8qKiBAdHlwZSB7e2NvbHVtbnM6IHN0cmluZ1tdLCBuYW1lPzogc3RyaW5nLCB0YWJsZU5hbWU6IHN0cmluZywgdW5pcXVlOiBib29sZWFufX0gKi9cbiAgICBjb25zdCBjcmVhdGVJbmRleEFyZ3MgPSB7XG4gICAgICBjb2x1bW5zOiBzb3VyY2VJbmRleC5nZXRDb2x1bW5OYW1lcygpLFxuICAgICAgdGFibGVOYW1lLFxuICAgICAgdW5pcXVlOiBzb3VyY2VJbmRleC5pc1VuaXF1ZSgpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMudGFyZ2V0RGIuZ2V0VHlwZSgpICE9PSBcInNxbGl0ZVwiKSB7XG4gICAgICBjcmVhdGVJbmRleEFyZ3MubmFtZSA9IHNvdXJjZUluZGV4LmdldE5hbWUoKVxuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVJbmRleEFyZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHR3byBpbmRleGVzIGhhdmUgdGhlIHNhbWUgdW5pcXVlbmVzcyBhbmQgb3JkZXJlZCBjb2x1bW4gbGlzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1ucy1pbmRleC5qc1wiKS5kZWZhdWx0fSBzb3VyY2VJbmRleCAtIFNvdXJjZSBpbmRleCBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHR9IHRhcmdldEluZGV4IC0gVGFyZ2V0IGluZGV4IGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYm90aCBpbmRleGVzIGhhdmUgdGhlIHNhbWUgc2hhcGUuXG4gICAqL1xuICBpbmRleGVzTWF0Y2goc291cmNlSW5kZXgsIHRhcmdldEluZGV4KSB7XG4gICAgY29uc3Qgc291cmNlQ29sdW1uTmFtZXMgPSBzb3VyY2VJbmRleC5nZXRDb2x1bW5OYW1lcygpXG4gICAgY29uc3QgdGFyZ2V0Q29sdW1uTmFtZXMgPSB0YXJnZXRJbmRleC5nZXRDb2x1bW5OYW1lcygpXG5cbiAgICBpZiAoc291cmNlSW5kZXguaXNVbmlxdWUoKSAhPT0gdGFyZ2V0SW5kZXguaXNVbmlxdWUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKHNvdXJjZUNvbHVtbk5hbWVzLmxlbmd0aCAhPT0gdGFyZ2V0Q29sdW1uTmFtZXMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBmb3IgKGxldCBjb2x1bW5JbmRleCA9IDA7IGNvbHVtbkluZGV4IDwgc291cmNlQ29sdW1uTmFtZXMubGVuZ3RoOyBjb2x1bW5JbmRleCsrKSB7XG4gICAgICBpZiAoc291cmNlQ29sdW1uTmFtZXNbY29sdW1uSW5kZXhdICE9PSB0YXJnZXRDb2x1bW5OYW1lc1tjb2x1bW5JbmRleF0pIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBBIHN0YWJsZSBzaWduYXR1cmUgZm9yIGFuIGluZGV4LCB1c2VkIHRvIG1hdGNoIGNsb25lZCBpbmRleGVzIGJ5IHNoYXBlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW5zLWluZGV4LmpzXCIpLmRlZmF1bHR9IGluZGV4IC0gSW5kZXggZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUgaW5kZXgtc2hhcGUgc2lnbmF0dXJlLlxuICAgKi9cbiAgaW5kZXhTaWduYXR1cmUoaW5kZXgpIHtcbiAgICByZXR1cm4gYCR7aW5kZXguaXNVbmlxdWUoKSA/IFwidW5pcXVlXCIgOiBcImluZGV4XCJ9OiR7aW5kZXguZ2V0Q29sdW1uTmFtZXMoKS5qb2luKFwiLFwiKX1gXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGNvbHVtbiB0eXBlIHRvIGl0cyBjYW5vbmljYWwgbG93ZXJjYXNlIGZvcm0gKGBpbnRgIGJlY29tZXMgYGludGVnZXJgKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtblR5cGUgLSBEYXRhYmFzZSBjb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDYW5vbmljYWwgbG93ZXJjYXNlIGNvbHVtbiB0eXBlLlxuICAgKi9cbiAgbm9ybWFsaXplZENvbHVtblR5cGUoY29sdW1uVHlwZSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpXG5cbiAgICBpZiAobm9ybWFsaXplZFR5cGUgPT09IFwiaW50XCIpIHtcbiAgICAgIHJldHVybiBcImludGVnZXJcIlxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB3aWRlbmluZyByYW5rIG9mIGEgdGV4dCBjb2x1bW4gdHlwZSAoMCB3aGVuIG5vdCBhIHRleHQgdHlwZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5UeXBlIC0gRGF0YWJhc2UgY29sdW1uIHR5cGUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGV4dC10eXBlIHdpZGVuaW5nIHJhbmsuXG4gICAqL1xuICB0ZXh0VHlwZVJhbmsoY29sdW1uVHlwZSkge1xuICAgIHJldHVybiBURVhUX1RZUEVfUkFOS1NbdGhpcy5ub3JtYWxpemVkQ29sdW1uVHlwZShjb2x1bW5UeXBlKV0gfHwgMFxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRhcmdldCdzIHRleHQgY29sdW1uIGlzIG5hcnJvd2VyIHRoYW4gdGhlIHNvdXJjZSdzIGFuZCBtdXN0IGJlIHdpZGVuZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0fSBzb3VyY2VDb2x1bW4gLSBTb3VyY2UgY29sdW1uIGRlZmluaXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0fSB0YXJnZXRDb2x1bW4gLSBUYXJnZXQgY29sdW1uIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHRhcmdldCB0ZXh0IGNvbHVtbiBtdXN0IGJlIHdpZGVuZWQuXG4gICAqL1xuICBjb2x1bW5OZWVkc1dpZGVuaW5nKHNvdXJjZUNvbHVtbiwgdGFyZ2V0Q29sdW1uKSB7XG4gICAgY29uc3Qgc291cmNlUmFuayA9IHRoaXMudGV4dFR5cGVSYW5rKHNvdXJjZUNvbHVtbi5nZXRUeXBlKCkpXG4gICAgY29uc3QgdGFyZ2V0UmFuayA9IHRoaXMudGV4dFR5cGVSYW5rKHRhcmdldENvbHVtbi5nZXRUeXBlKCkpXG5cbiAgICByZXR1cm4gc291cmNlUmFuayA+IDAgJiYgdGFyZ2V0UmFuayA+IDAgJiYgc291cmNlUmFuayA+IHRhcmdldFJhbmtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgVGFibGVEYXRhIGNvbHVtbiBhcmdzIGZyb20gYSBzb3VyY2UgY29sdW1uLCBjb3B5aW5nIHR5cGUsIG51bGxhYmlsaXR5LFxuICAgKiBsZW5ndGgsIG5vdGVzLCBzaW1wbGUgZGVmYXVsdHMgYW5kIChmb3IgZnVsbCBjbG9uZXMpIHByaW1hcnkta2V5IGZsYWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0fSBzb3VyY2VDb2x1bW4gLSBTb3VyY2UgY29sdW1uIGRlZmluaXRpb24uXG4gICAqIEBwYXJhbSB7e2lzTmV3Q29sdW1uOiBib29sZWFufX0gYXJncyAtIFdoZXRoZXIgdGhlIGNvbHVtbiBpcyBiZWluZyBhZGRlZCBpbnN0ZWFkIG9mIGNsb25lZCB3aXRoIGl0cyB0YWJsZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIEFyZ3VtZW50cyBmb3IgYWx0ZXJpbmcgdGhlIHRhcmdldCBjb2x1bW4uXG4gICAqL1xuICBjb2x1bW5BcmdzRnJvbVNvdXJjZUNvbHVtbihzb3VyY2VDb2x1bW4sIHtpc05ld0NvbHVtbn0pIHtcbiAgICAvKiogQHR5cGUge3thdXRvSW5jcmVtZW50PzogYm9vbGVhbiwgZGVmYXVsdD86IHVua25vd24sIGlzTmV3Q29sdW1uOiBib29sZWFuLCBtYXhMZW5ndGg/OiBudW1iZXIsIG5vdGVzPzogc3RyaW5nLCBudWxsOiBib29sZWFuLCBwcmltYXJ5S2V5PzogYm9vbGVhbiwgdHlwZTogc3RyaW5nfX0gKi9cbiAgICBjb25zdCBjb2x1bW5BcmdzID0ge1xuICAgICAgaXNOZXdDb2x1bW4sXG4gICAgICBudWxsOiBzb3VyY2VDb2x1bW4uZ2V0TnVsbCgpLFxuICAgICAgdHlwZTogdGhpcy5ub3JtYWxpemVkQ29sdW1uVHlwZShzb3VyY2VDb2x1bW4uZ2V0VHlwZSgpKVxuICAgIH1cbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBzb3VyY2VDb2x1bW4uZ2V0RGVmYXVsdCgpXG4gICAgY29uc3QgbWF4TGVuZ3RoID0gc291cmNlQ29sdW1uLmdldE1heExlbmd0aCgpXG4gICAgY29uc3Qgbm90ZXMgPSBzb3VyY2VDb2x1bW4uZ2V0Tm90ZXMoKVxuXG4gICAgaWYgKCFpc05ld0NvbHVtbiAmJiBzb3VyY2VDb2x1bW4uZ2V0UHJpbWFyeUtleSgpKSB7XG4gICAgICBjb2x1bW5BcmdzLnByaW1hcnlLZXkgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHNvdXJjZUNvbHVtbi5nZXRBdXRvSW5jcmVtZW50KCkpIHtcbiAgICAgIGNvbHVtbkFyZ3MuYXV0b0luY3JlbWVudCA9IHRydWVcbiAgICB9XG5cbiAgICAvLyBBIG1heExlbmd0aCBvZiAtMSBpcyB0aGUgTVMtU1FMIFwibWF4XCIgc2VudGluZWwgKE5WQVJDSEFSKE1BWCkgLyBWQVJCSU5BUlkoTUFYKSxcbiAgICAvLyBiYWNraW5nIFZlbG9jaW91cyB0ZXh0L2pzb24vYmxvYiBjb2x1bW5zKTsgdGhlIGNvbHVtbiB0eXBlIGRyaXZlcyB0aGUgdW5ib3VuZGVkXG4gICAgLy8gU1FMLCBzbyBkb24ndCBmb3J3YXJkIC0xIGFzIGFuIGV4cGxpY2l0IGxlbmd0aCAoaXQgd291bGQgZW1pdCBOVkFSQ0hBUigtMSkpLlxuICAgIGlmIChtYXhMZW5ndGggIT09IHVuZGVmaW5lZCAmJiBtYXhMZW5ndGggPj0gMCkge1xuICAgICAgY29sdW1uQXJncy5tYXhMZW5ndGggPSBtYXhMZW5ndGhcbiAgICB9XG5cbiAgICBpZiAobm90ZXMpIHtcbiAgICAgIGNvbHVtbkFyZ3Mubm90ZXMgPSBub3Rlc1xuICAgIH1cblxuICAgIGlmIChkZWZhdWx0VmFsdWUgIT09IG51bGwgJiYgZGVmYXVsdFZhbHVlICE9PSB1bmRlZmluZWQgJiYgU0lNUExFX0RFRkFVTFRfUEFUVEVSTi50ZXN0KFN0cmluZyhkZWZhdWx0VmFsdWUpKSkge1xuICAgICAgY29sdW1uQXJncy5kZWZhdWx0ID0gZGVmYXVsdFZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbHVtbkFyZ3NcbiAgfVxufVxuIl19