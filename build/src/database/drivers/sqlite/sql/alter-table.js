// @ts-check
import AlterTableBase from "../../../query/alter-table-base.js";
import Logger from "../../../../logger.js";
import restArgsError from "../../../../utils/rest-args-error.js";
import TableData from "../../../table-data/index.js";
import TableForeignKey from "../../../table-data/table-foreign-key.js";
import TableIndex from "../../../table-data/table-index.js";
import TableRebuilder from "../table-rebuilder.js";
export default class VelociousDatabaseConnectionDriversSqliteSqlAlterTable extends AlterTableBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../base.js").default} args.driver - Database driver instance.
     * @param {import("../../../table-data/index.js").default} args.tableData - Table data.
     */
    constructor({ driver, tableData, ...restArgs }) {
        restArgsError(restArgs);
        if (!(tableData instanceof TableData))
            throw new Error("Invalid table data was given");
        super({ driver, tableData });
        this.logger = new Logger(this);
        this.tableData = tableData;
    }
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async toSQLs() {
        const driver = this.getDriver();
        const { tableData: alterTableData } = this;
        const tableName = alterTableData.getName();
        const table = await driver.getTableByName(tableName);
        if (!table)
            throw new Error(`Table ${tableName} does not exist`);
        const currentTableData = await table.getTableData();
        const { targetTableData, columnPairs } = this._buildTargetSchema(currentTableData, alterTableData);
        const rebuilder = new TableRebuilder({
            columnPairs,
            driver,
            originalTableName: tableName,
            targetTableData
        });
        const rebuildSQLs = await rebuilder.toSQLs();
        const sqls = [];
        // PRAGMA foreign_keys can only be toggled outside an active transaction; when the
        // caller is already inside one these become no-ops (matching prior behavior). Outside
        // a transaction they protect the rebuild from cross-table FK enforcement during the
        // DROP/RENAME swap. Capture the prior state so we restore it instead of unconditionally
        // forcing ON — callers that deliberately disabled FK enforcement (e.g. bulk data fixes)
        // shouldn't be silently flipped back on by a migration.
        const priorState = await driver.query("PRAGMA foreign_keys");
        const wasEnabled = priorState[0]?.foreign_keys == 1;
        sqls.push("PRAGMA foreign_keys = OFF");
        for (const sql of rebuildSQLs)
            sqls.push(sql);
        sqls.push(`PRAGMA foreign_keys = ${wasEnabled ? "ON" : "OFF"}`);
        return sqls;
    }
    /**
     * Merges the current schema with the alter request to produce the desired final schema
     * and the column copy plan.
     * @param {TableData} currentTableData - Current schema as introspected from the database.
     * @param {TableData} alterTableData - Alter request: new columns (`isNewColumn`), renames (`newName`), drops (`dropColumn`), modifies, and new foreign keys.
     * @returns {{targetTableData: TableData, columnPairs: Array<[string, string]>}} - The merged target schema and the [oldName, newName] pairs for INSERT...SELECT.
     */
    _buildTargetSchema(currentTableData, alterTableData) {
        const targetTableData = new TableData(currentTableData.getName());
        /**
         * Column pairs.
         * @type {Array<[string, string]>} */
        const columnPairs = [];
        const alterColumns = alterTableData.getColumns();
        const existingNames = new Set(currentTableData.getColumns().map((column) => column.getName()));
        /**
         * Column renames.
         * @type {Map<string, string>} */
        const columnRenames = new Map();
        for (const alterColumn of alterColumns) {
            if (alterColumn.isNewColumn())
                continue;
            const newName = alterColumn.getNewName();
            if (newName)
                columnRenames.set(alterColumn.getName(), newName);
        }
        for (const currentColumn of currentTableData.getColumns()) {
            const alterColumn = alterColumns.find((column) => column.getName() == currentColumn.getName() && !column.isNewColumn());
            if (alterColumn?.getDropColumn())
                continue;
            let targetColumn;
            if (alterColumn) {
                // The alter request supplies a partial column spec (e.g. just a rename or a type change);
                // inherit unset properties from the current column so we don't lose existing definitions.
                alterColumn.setAutoIncrement(alterColumn.getAutoIncrement() || currentColumn.getAutoIncrement());
                if (alterColumn.getDefault() === undefined)
                    alterColumn.setDefault(currentColumn.getDefault());
                if (!alterColumn.getIndex())
                    alterColumn.setIndex(currentColumn.getIndex());
                if (!alterColumn.getForeignKey())
                    alterColumn.setForeignKey(currentColumn.getForeignKey());
                if (alterColumn.getMaxLength() === undefined)
                    alterColumn.setMaxLength(currentColumn.getMaxLength());
                alterColumn.setPrimaryKey(alterColumn.getPrimaryKey() || currentColumn.getPrimaryKey());
                if (!alterColumn.getType())
                    alterColumn.setType(currentColumn.getType());
                targetColumn = alterColumn;
            }
            else {
                targetColumn = currentColumn;
            }
            targetTableData.addColumn(targetColumn);
            columnPairs.push([currentColumn.getName(), targetColumn.getNewName() || targetColumn.getName()]);
        }
        for (const alterColumn of alterColumns) {
            if (!alterColumn.isNewColumn())
                continue;
            if (existingNames.has(alterColumn.getName()))
                continue;
            targetTableData.addColumn(alterColumn);
        }
        const seenForeignKeyNames = new Set();
        for (const currentForeignKey of currentTableData.getForeignKeys()) {
            const alterForeignKey = alterTableData.getForeignKeys().find((foreignKey) => foreignKey.getName() == currentForeignKey.getName());
            if (alterForeignKey?.getDropForeignKey()) {
                const targetColumnName = columnRenames.get(currentForeignKey.getColumnName()) || currentForeignKey.getColumnName();
                const targetColumn = targetTableData.getColumns().find((column) => column.getActualName() == targetColumnName);
                if (targetColumn)
                    targetColumn.setForeignKey(undefined);
                continue;
            }
            const finalForeignKey = this._renameForeignKeyColumn(alterForeignKey || currentForeignKey, columnRenames);
            seenForeignKeyNames.add(finalForeignKey.getName());
            targetTableData.addForeignKey(finalForeignKey);
        }
        for (const alterForeignKey of alterTableData.getForeignKeys()) {
            if (alterForeignKey.getDropForeignKey())
                continue;
            if (seenForeignKeyNames.has(alterForeignKey.getName()))
                continue;
            targetTableData.addForeignKey(this._renameForeignKeyColumn(alterForeignKey, columnRenames));
        }
        const targetColumnNames = new Set(targetTableData.getColumns().map((column) => column.getActualName()));
        for (const currentIndex of currentTableData.getIndexes()) {
            const renamedColumns = currentIndex.getColumns().map((columnName) => {
                if (typeof columnName != "string")
                    return columnName;
                return columnRenames.get(columnName) || columnName;
            });
            const indexColumnNames = renamedColumns.map((column) => typeof column == "string" ? column : column.getName());
            if (indexColumnNames.some((columnName) => !targetColumnNames.has(columnName)))
                continue;
            targetTableData.addIndex(new TableIndex(renamedColumns, {
                name: currentIndex.getName(),
                unique: currentIndex.getUnique()
            }));
        }
        return { targetTableData, columnPairs };
    }
    /**
     * Returns the foreign key with its column name updated when the column was renamed in the
     * alter request. SQLite re-creates the constraint inside the rebuilt CREATE TABLE, so a
     * stale column name there would reference a column that no longer exists.
     * @param {TableForeignKey} foreignKey - Foreign key to evaluate.
     * @param {Map<string, string>} columnRenames - Map of old → new column names from the alter request.
     * @returns {TableForeignKey} - The original foreign key, or a fresh instance with the renamed column.
     */
    _renameForeignKeyColumn(foreignKey, columnRenames) {
        const renamed = columnRenames.get(foreignKey.getColumnName());
        if (!renamed)
            return foreignKey;
        return new TableForeignKey({
            columnName: renamed,
            dropForeignKey: foreignKey.getDropForeignKey(),
            isNewForeignKey: foreignKey.getIsNewForeignKey(),
            name: foreignKey.getName(),
            referencedColumnName: foreignKey.getReferencedColumnName(),
            referencedTableName: foreignKey.getReferencedTableName(),
            tableName: foreignKey.getTableName()
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWx0ZXItdGFibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9zcWxpdGUvc3FsL2FsdGVyLXRhYmxlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGNBQWMsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMvRCxPQUFPLE1BQU0sTUFBTSx1QkFBdUIsQ0FBQTtBQUMxQyxPQUFPLGFBQWEsTUFBTSxzQ0FBc0MsQ0FBQTtBQUNoRSxPQUFPLFNBQVMsTUFBTSw4QkFBOEIsQ0FBQTtBQUNwRCxPQUFPLGVBQWUsTUFBTSwwQ0FBMEMsQ0FBQTtBQUN0RSxPQUFPLFVBQVUsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUVsRCxNQUFNLENBQUMsT0FBTyxPQUFPLHFEQUFzRCxTQUFRLGNBQWM7SUFDL0Y7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsRUFBQztRQUMxQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLENBQUMsU0FBUyxZQUFZLFNBQVMsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQTtRQUV0RixLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtRQUMxQixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO0lBQzVCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsTUFBTTtRQUNWLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUMvQixNQUFNLEVBQUMsU0FBUyxFQUFFLGNBQWMsRUFBQyxHQUFHLElBQUksQ0FBQTtR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a1xuXG5pbXBvcnQgQWx0ZXJUYWJsZUJhc2UgZnJvbSBcIi4uLy4uLy4uL3F1ZXJ5L2FsdGVyLXRhYmxlLWJhc2UuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi8uLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVGFibGVGb3JlaWduS2V5IGZyb20gXCIuLi8uLi8uLi90YWJsZS1kYXRhL3RhYmxlLWZvcmVpZ24ta2V5LmpzXCJcbmltcG9ydCBUYWJsZUluZGV4IGZyb20gXCIuLi8uLi8uLi90YWJsZS1kYXRhL3RhYmxlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZVJlYnVpbGRlciBmcm9tIFwiLi4vdGFibGUtcmVidWlsZGVyLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VDb25uZWN0aW9uRHJpdmVyc1NxbGl0ZVNxbEFsdGVyVGFibGUgZXh0ZW5kcyBBbHRlclRhYmxlQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kcml2ZXIgLSBEYXRhYmFzZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7ZHJpdmVyLCB0YWJsZURhdGEsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoISh0YWJsZURhdGEgaW5zdGFuY2VvZiBUYWJsZURhdGEpKSB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIHRhYmxlIGRhdGEgd2FzIGdpdmVuXCIpXG5cbiAgICBzdXBlcih7ZHJpdmVyLCB0YWJsZURhdGF9KVxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMudGFibGVEYXRhID0gdGFibGVEYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHRvU1FMcygpIHtcbiAgICBjb25zdCBkcml2ZXIgPSB0aGlzLmdldERyaXZlcigpXG4gICAgY29uc3Qge3RhYmxlRGF0YTogYWx0ZXJUYWJsZURhdGF9ID0gdGhpc1xuICAgIGNvbnN0IHRhYmxlTmFtZSA9IGFsdGVyVGFibGVEYXRhLmdldE5hbWUoKVxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZHJpdmVyLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSlcblxuICAgIGlmICghdGFibGUpIHRocm93IG5ldyBFcnJvcihgVGFibGUgJHt0YWJsZU5hbWV9IGRvZXMgbm90IGV4aXN0YClcblxuICAgIGNvbnN0IGN1cnJlbnRUYWJsZURhdGEgPSBhd2FpdCB0YWJsZS5nZXRUYWJsZURhdGEoKVxuICAgIGNvbnN0IHt0YXJnZXRUYWJsZURhdGEsIGNvbHVtblBhaXJzfSA9IHRoaXMuX2J1aWxkVGFyZ2V0U2NoZW1hKGN1cnJlbnRUYWJsZURhdGEsIGFsdGVyVGFibGVEYXRhKVxuXG4gICAgY29uc3QgcmVidWlsZGVyID0gbmV3IFRhYmxlUmVidWlsZGVyKHtcbiAgICAgIGNvbHVtblBhaXJzLFxuICAgICAgZHJpdmVyLFxuICAgICAgb3JpZ2luYWxUYWJsZU5hbWU6IHRhYmxlTmFtZSxcbiAgICAgIHRhcmdldFRhYmxlRGF0YVxuICAgIH0pXG5cbiAgICBjb25zdCByZWJ1aWxkU1FMcyA9IGF3YWl0IHJlYnVpbGRlci50b1NRTHMoKVxuICAgIGNvbnN0IHNxbHMgPSBbXVxuXG4gICAgLy8gUFJBR01BIGZvcmVpZ25fa2V5cyBjYW4gb25seSBiZSB0b2dnbGVkIG91dHNpZGUgYW4gYWN0aXZlIHRyYW5zYWN0aW9uOyB3aGVuIHRoZVxuICAgIC8vIGNhbGxlciBpcyBhbHJlYWR5IGluc2lkZSBvbmUgdGhlc2UgYmVjb21lIG5vLW9wcyAobWF0Y2hpbmcgcHJpb3IgYmVoYXZpb3IpLiBPdXRzaWRlXG4gICAgLy8gYSB0cmFuc2FjdGlvbiB0aGV5IHByb3RlY3QgdGhlIHJlYnVpbGQgZnJvbSBjcm9zcy10YWJsZSBGSyBlbmZvcmNlbWVudCBkdXJpbmcgdGhlXG4gICAgLy8gRFJPUC9SRU5BTUUgc3dhcC4gQ2FwdHVyZSB0aGUgcHJpb3Igc3RhdGUgc28gd2UgcmVzdG9yZSBpdCBpbnN0ZWFkIG9mIHVuY29uZGl0aW9uYWxseVxuICAgIC8vIGZvcmNpbmcgT04g4oCUIGNhbGxlcnMgdGhhdCBkZWxpYmVyYXRlbHkgZGlzYWJsZWQgRksgZW5mb3JjZW1lbnQgKGUuZy4gYnVsayBkYXRhIGZpeGVzKVxuICAgIC8vIHNob3VsZG4ndCBiZSBzaWxlbnRseSBmbGlwcGVkIGJhY2sgb24gYnkgYSBtaWdyYXRpb24uXG4gICAgY29uc3QgcHJpb3JTdGF0ZSA9IGF3YWl0IGRyaXZlci5xdWVyeShcIlBSQUdNQSBmb3JlaWduX2tleXNcIilcbiAgICBjb25zdCB3YXNFbmFibGVkID0gcHJpb3JTdGF0ZVswXT8uZm9yZWlnbl9rZXlzID09IDFcblxuICAgIHNxbHMucHVzaChcIlBSQUdNQSBmb3JlaWduX2tleXMgPSBPRkZcIilcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHJlYnVpbGRTUUxzKSBzcWxzLnB1c2goc3FsKVxuXG4gICAgc3Fscy5wdXNoKGBQUkFHTUEgZm9yZWlnbl9rZXlzID0gJHt3YXNFbmFibGVkID8gXCJPTlwiIDogXCJPRkZcIn1gKVxuXG4gICAgcmV0dXJuIHNxbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgdGhlIGN1cnJlbnQgc2NoZW1hIHdpdGggdGhlIGFsdGVyIHJlcXVlc3QgdG8gcHJvZHVjZSB0aGUgZGVzaXJlZCBmaW5hbCBzY2hlbWFcbiAgICogYW5kIHRoZSBjb2x1bW4gY29weSBwbGFuLlxuICAgKiBAcGFyYW0ge1RhYmxlRGF0YX0gY3VycmVudFRhYmxlRGF0YSAtIEN1cnJlbnQgc2NoZW1hIGFzIGludHJvc3BlY3RlZCBmcm9tIHRoZSBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtUYWJsZURhdGF9IGFsdGVyVGFibGVEYXRhIC0gQWx0ZXIgcmVxdWVzdDogbmV3IGNvbHVtbnMgKGBpc05ld0NvbHVtbmApLCByZW5hbWVzIChgbmV3TmFtZWApLCBkcm9wcyAoYGRyb3BDb2x1bW5gKSwgbW9kaWZpZXMsIGFuZCBuZXcgZm9yZWlnbiBrZXlzLlxuICAgKiBAcmV0dXJucyB7e3RhcmdldFRhYmxlRGF0YTogVGFibGVEYXRhLCBjb2x1bW5QYWlyczogQXJyYXk8W3N0cmluZywgc3RyaW5nXT59fSAtIFRoZSBtZXJnZWQgdGFyZ2V0IHNjaGVtYSBhbmQgdGhlIFtvbGROYW1lLCBuZXdOYW1lXSBwYWlycyBmb3IgSU5TRVJULi4uU0VMRUNULlxuICAgKi9cbiAgX2J1aWxkVGFyZ2V0U2NoZW1hKGN1cnJlbnRUYWJsZURhdGEsIGFsdGVyVGFibGVEYXRhKSB7XG4gICAgY29uc3QgdGFyZ2V0VGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShjdXJyZW50VGFibGVEYXRhLmdldE5hbWUoKSlcbiAgICAvKipcbiAgICAgKiBDb2x1bW4gcGFpcnMuXG4gICAgICogQHR5cGUge0FycmF5PFtzdHJpbmcsIHN0cmluZ10+fSAqL1xuICAgIGNvbnN0IGNvbHVtblBhaXJzID0gW11cbiAgICBjb25zdCBhbHRlckNvbHVtbnMgPSBhbHRlclRhYmxlRGF0YS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBleGlzdGluZ05hbWVzID0gbmV3IFNldChjdXJyZW50VGFibGVEYXRhLmdldENvbHVtbnMoKS5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSkpXG4gICAgLyoqXG4gICAgICogQ29sdW1uIHJlbmFtZXMuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgY29uc3QgY29sdW1uUmVuYW1lcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBhbHRlckNvbHVtbiBvZiBhbHRlckNvbHVtbnMpIHtcbiAgICAgIGlmIChhbHRlckNvbHVtbi5pc05ld0NvbHVtbigpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBuZXdOYW1lID0gYWx0ZXJDb2x1bW4uZ2V0TmV3TmFtZSgpXG5cbiAgICAgIGlmIChuZXdOYW1lKSBjb2x1bW5SZW5hbWVzLnNldChhbHRlckNvbHVtbi5nZXROYW1lKCksIG5ld05hbWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjdXJyZW50Q29sdW1uIG9mIGN1cnJlbnRUYWJsZURhdGEuZ2V0Q29sdW1ucygpKSB7XG4gICAgICBjb25zdCBhbHRlckNvbHVtbiA9IGFsdGVyQ29sdW1ucy5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gY3VycmVudENvbHVtbi5nZXROYW1lKCkgJiYgIWNvbHVtbi5pc05ld0NvbHVtbigpKVxuXG4gICAgICBpZiAoYWx0ZXJDb2x1bW4/LmdldERyb3BDb2x1bW4oKSkgY29udGludWVcblxuICAgICAgbGV0IHRhcmdldENvbHVtblxuXG4gICAgICBpZiAoYWx0ZXJDb2x1bW4pIHtcbiAgICAgICAgLy8gVGhlIGFsdGVyIHJlcXVlc3Qgc3VwcGxpZXMgYSBwYXJ0aWFsIGNvbHVtbiBzcGVjIChlLmcuIGp1c3QgYSByZW5hbWUgb3IgYSB0eXBlIGNoYW5nZSk7XG4gICAgICAgIC8vIGluaGVyaXQgdW5zZXQgcHJvcGVydGllcyBmcm9tIHRoZSBjdXJyZW50IGNvbHVtbiBzbyB3ZSBkb24ndCBsb3NlIGV4aXN0aW5nIGRlZmluaXRpb25zLlxuICAgICAgICBhbHRlckNvbHVtbi5zZXRBdXRvSW5jcmVtZW50KGFsdGVyQ29sdW1uLmdldEF1dG9JbmNyZW1lbnQoKSB8fCBjdXJyZW50Q29sdW1uLmdldEF1dG9JbmNyZW1lbnQoKSlcbiAgICAgICAgaWYgKGFsdGVyQ29sdW1uLmdldERlZmF1bHQoKSA9PT0gdW5kZWZpbmVkKSBhbHRlckNvbHVtbi5zZXREZWZhdWx0KGN1cnJlbnRDb2x1bW4uZ2V0RGVmYXVsdCgpKVxuICAgICAgICBpZiAoIWFsdGVyQ29sdW1uLmdldEluZGV4KCkpIGFsdGVyQ29sdW1uLnNldEluZGV4KGN1cnJlbnRDb2x1bW4uZ2V0SW5kZXgoKSlcbiAgICAgICAgaWYgKCFhbHRlckNvbHVtbi5nZXRGb3JlaWduS2V5KCkpIGFsdGVyQ29sdW1uLnNldEZvcmVpZ25LZXkoY3VycmVudENvbHVtbi5nZXRGb3JlaWduS2V5KCkpXG4gICAgICAgIGlmIChhbHRlckNvbHVtbi5nZXRNYXhMZW5ndGgoKSA9PT0gdW5kZWZpbmVkKSBhbHRlckNvbHVtbi5zZXRNYXhMZW5ndGgoY3VycmVudENvbHVtbi5nZXRNYXhMZW5ndGgoKSlcbiAgICAgICAgYWx0ZXJDb2x1bW4uc2V0UHJpbWFyeUtleShhbHRlckNvbHVtbi5nZXRQcmltYXJ5S2V5KCkgfHwgY3VycmVudENvbHVtbi5nZXRQcmltYXJ5S2V5KCkpXG4gICAgICAgIGlmICghYWx0ZXJDb2x1bW4uZ2V0VHlwZSgpKSBhbHRlckNvbHVtbi5zZXRUeXBlKGN1cnJlbnRDb2x1bW4uZ2V0VHlwZSgpKVxuXG4gICAgICAgIHRhcmdldENvbHVtbiA9IGFsdGVyQ29sdW1uXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0YXJnZXRDb2x1bW4gPSBjdXJyZW50Q29sdW1uXG4gICAgICB9XG5cbiAgICAgIHRhcmdldFRhYmxlRGF0YS5hZGRDb2x1bW4odGFyZ2V0Q29sdW1uKVxuICAgICAgY29sdW1uUGFpcnMucHVzaChbY3VycmVudENvbHVtbi5nZXROYW1lKCksIHRhcmdldENvbHVtbi5nZXROZXdOYW1lKCkgfHwgdGFyZ2V0Q29sdW1uLmdldE5hbWUoKV0pXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhbHRlckNvbHVtbiBvZiBhbHRlckNvbHVtbnMpIHtcbiAgICAgIGlmICghYWx0ZXJDb2x1bW4uaXNOZXdDb2x1bW4oKSkgY29udGludWVcbiAgICAgIGlmIChleGlzdGluZ05hbWVzLmhhcyhhbHRlckNvbHVtbi5nZXROYW1lKCkpKSBjb250aW51ZVxuXG4gICAgICB0YXJnZXRUYWJsZURhdGEuYWRkQ29sdW1uKGFsdGVyQ29sdW1uKVxuICAgIH1cblxuICAgIGNvbnN0IHNlZW5Gb3JlaWduS2V5TmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgY3VycmVudEZvcmVpZ25LZXkgb2YgY3VycmVudFRhYmxlRGF0YS5nZXRGb3JlaWduS2V5cygpKSB7XG4gICAgICBjb25zdCBhbHRlckZvcmVpZ25LZXkgPSBhbHRlclRhYmxlRGF0YS5nZXRGb3JlaWduS2V5cygpLmZpbmQoKGZvcmVpZ25LZXkpID0+IGZvcmVpZ25LZXkuZ2V0TmFtZSgpID09IGN1cnJlbnRGb3JlaWduS2V5LmdldE5hbWUoKSlcblxuICAgICAgaWYgKGFsdGVyRm9yZWlnbktleT8uZ2V0RHJvcEZvcmVpZ25LZXkoKSkge1xuICAgICAgICBjb25zdCB0YXJnZXRDb2x1bW5OYW1lID0gY29sdW1uUmVuYW1lcy5nZXQoY3VycmVudEZvcmVpZ25LZXkuZ2V0Q29sdW1uTmFtZSgpKSB8fCBjdXJyZW50Rm9yZWlnbktleS5nZXRDb2x1bW5OYW1lKClcbiAgICAgICAgY29uc3QgdGFyZ2V0Q29sdW1uID0gdGFyZ2V0VGFibGVEYXRhLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXRBY3R1YWxOYW1lKCkgPT0gdGFyZ2V0Q29sdW1uTmFtZSlcblxuICAgICAgICBpZiAodGFyZ2V0Q29sdW1uKSB0YXJnZXRDb2x1bW4uc2V0Rm9yZWlnbktleSh1bmRlZmluZWQpXG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmluYWxGb3JlaWduS2V5ID0gdGhpcy5fcmVuYW1lRm9yZWlnbktleUNvbHVtbihhbHRlckZvcmVpZ25LZXkgfHwgY3VycmVudEZvcmVpZ25LZXksIGNvbHVtblJlbmFtZXMpXG5cbiAgICAgIHNlZW5Gb3JlaWduS2V5TmFtZXMuYWRkKGZpbmFsRm9yZWlnbktleS5nZXROYW1lKCkpXG4gICAgICB0YXJnZXRUYWJsZURhdGEuYWRkRm9yZWlnbktleShmaW5hbEZvcmVpZ25LZXkpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhbHRlckZvcmVpZ25LZXkgb2YgYWx0ZXJUYWJsZURhdGEuZ2V0Rm9yZWlnbktleXMoKSkge1xuICAgICAgaWYgKGFsdGVyRm9yZWlnbktleS5nZXREcm9wRm9yZWlnbktleSgpKSBjb250aW51ZVxuICAgICAgaWYgKHNlZW5Gb3JlaWduS2V5TmFtZXMuaGFzKGFsdGVyRm9yZWlnbktleS5nZXROYW1lKCkpKSBjb250aW51ZVxuXG4gICAgICB0YXJnZXRUYWJsZURhdGEuYWRkRm9yZWlnbktleSh0aGlzLl9yZW5hbWVGb3JlaWduS2V5Q29sdW1uKGFsdGVyRm9yZWlnbktleSwgY29sdW1uUmVuYW1lcykpXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0Q29sdW1uTmFtZXMgPSBuZXcgU2V0KHRhcmdldFRhYmxlRGF0YS5nZXRDb2x1bW5zKCkubWFwKChjb2x1bW4pID0+IGNvbHVtbi5nZXRBY3R1YWxOYW1lKCkpKVxuXG4gICAgZm9yIChjb25zdCBjdXJyZW50SW5kZXggb2YgY3VycmVudFRhYmxlRGF0YS5nZXRJbmRleGVzKCkpIHtcbiAgICAgIGNvbnN0IHJlbmFtZWRDb2x1bW5zID0gY3VycmVudEluZGV4LmdldENvbHVtbnMoKS5tYXAoKGNvbHVtbk5hbWUpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb2x1bW5OYW1lICE9IFwic3RyaW5nXCIpIHJldHVybiBjb2x1bW5OYW1lXG5cbiAgICAgICAgcmV0dXJuIGNvbHVtblJlbmFtZXMuZ2V0KGNvbHVtbk5hbWUpIHx8IGNvbHVtbk5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGluZGV4Q29sdW1uTmFtZXMgPSByZW5hbWVkQ29sdW1ucy5tYXAoKGNvbHVtbikgPT4gdHlwZW9mIGNvbHVtbiA9PSBcInN0cmluZ1wiID8gY29sdW1uIDogY29sdW1uLmdldE5hbWUoKSlcblxuICAgICAgaWYgKGluZGV4Q29sdW1uTmFtZXMuc29tZSgoY29sdW1uTmFtZSkgPT4gIXRhcmdldENvbHVtbk5hbWVzLmhhcyhjb2x1bW5OYW1lKSkpIGNvbnRpbnVlXG5cbiAgICAgIHRhcmdldFRhYmxlRGF0YS5hZGRJbmRleChuZXcgVGFibGVJbmRleChyZW5hbWVkQ29sdW1ucywge1xuICAgICAgICBuYW1lOiBjdXJyZW50SW5kZXguZ2V0TmFtZSgpLFxuICAgICAgICB1bmlxdWU6IGN1cnJlbnRJbmRleC5nZXRVbmlxdWUoKVxuICAgICAgfSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHt0YXJnZXRUYWJsZURhdGEsIGNvbHVtblBhaXJzfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZvcmVpZ24ga2V5IHdpdGggaXRzIGNvbHVtbiBuYW1lIHVwZGF0ZWQgd2hlbiB0aGUgY29sdW1uIHdhcyByZW5hbWVkIGluIHRoZVxuICAgKiBhbHRlciByZXF1ZXN0LiBTUUxpdGUgcmUtY3JlYXRlcyB0aGUgY29uc3RyYWludCBpbnNpZGUgdGhlIHJlYnVpbHQgQ1JFQVRFIFRBQkxFLCBzbyBhXG4gICAqIHN0YWxlIGNvbHVtbiBuYW1lIHRoZXJlIHdvdWxkIHJlZmVyZW5jZSBhIGNvbHVtbiB0aGF0IG5vIGxvbmdlciBleGlzdHMuXG4gICAqIEBwYXJhbSB7VGFibGVGb3JlaWduS2V5fSBmb3JlaWduS2V5IC0gRm9yZWlnbiBrZXkgdG8gZXZhbHVhdGUuXG4gICAqIEBwYXJhbSB7TWFwPHN0cmluZywgc3RyaW5nPn0gY29sdW1uUmVuYW1lcyAtIE1hcCBvZiBvbGQg4oaSIG5ldyBjb2x1bW4gbmFtZXMgZnJvbSB0aGUgYWx0ZXIgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1RhYmxlRm9yZWlnbktleX0gLSBUaGUgb3JpZ2luYWwgZm9yZWlnbiBrZXksIG9yIGEgZnJlc2ggaW5zdGFuY2Ugd2l0aCB0aGUgcmVuYW1lZCBjb2x1bW4uXG4gICAqL1xuICBfcmVuYW1lRm9yZWlnbktleUNvbHVtbihmb3JlaWduS2V5LCBjb2x1bW5SZW5hbWVzKSB7XG4gICAgY29uc3QgcmVuYW1lZCA9IGNvbHVtblJlbmFtZXMuZ2V0KGZvcmVpZ25LZXkuZ2V0Q29sdW1uTmFtZSgpKVxuXG4gICAgaWYgKCFyZW5hbWVkKSByZXR1cm4gZm9yZWlnbktleVxuXG4gICAgcmV0dXJuIG5ldyBUYWJsZUZvcmVpZ25LZXkoe1xuICAgICAgY29sdW1uTmFtZTogcmVuYW1lZCxcbiAgICAgIGRyb3BGb3JlaWduS2V5OiBmb3JlaWduS2V5LmdldERyb3BGb3JlaWduS2V5KCksXG4gICAgICBpc05ld0ZvcmVpZ25LZXk6IGZvcmVpZ25LZXkuZ2V0SXNOZXdGb3JlaWduS2V5KCksXG4gICAgICBuYW1lOiBmb3JlaWduS2V5LmdldE5hbWUoKSxcbiAgICAgIHJlZmVyZW5jZWRDb2x1bW5OYW1lOiBmb3JlaWduS2V5LmdldFJlZmVyZW5jZWRDb2x1bW5OYW1lKCksXG4gICAgICByZWZlcmVuY2VkVGFibGVOYW1lOiBmb3JlaWduS2V5LmdldFJlZmVyZW5jZWRUYWJsZU5hbWUoKSxcbiAgICAgIHRhYmxlTmFtZTogZm9yZWlnbktleS5nZXRUYWJsZU5hbWUoKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==