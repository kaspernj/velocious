// @ts-check
import BaseTable from "../base-table.js";
import Column from "./column.js";
import ColumnsIndex from "./columns-index.js";
import { digg } from "diggerize";
import ForeignKey from "./foreign-key.js";
import { normalizeIndexMetadataRow } from "../index-metadata.js";
/**
 * MssqlGroupedIndexDataType type.
 * @typedef {object} MssqlGroupedIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */
/**
 * Groups ordered SQL Server index rows into one metadata value per index.
 * @param {import("../index-metadata.js").IndexMetadataType[]} indexRows - Ordered index metadata rows.
 * @returns {MssqlGroupedIndexDataType[]} - Grouped index metadata.
 */
export function groupMssqlIndexRows(indexRows) {
    /** @type {Map<string, MssqlGroupedIndexDataType>} */
    const indexDataByName = new Map();
    /** @type {MssqlGroupedIndexDataType[]} */
    const groupedIndexData = [];
    for (const indexRow of indexRows) {
        const existingIndexData = indexDataByName.get(indexRow.index_name);
        if (existingIndexData) {
            existingIndexData.columnNames.push(indexRow.column_name);
            continue;
        }
        const indexData = {
            columnNames: [indexRow.column_name],
            index_name: indexRow.index_name,
            is_primary_key: indexRow.is_primary_key,
            is_unique: indexRow.is_unique,
            table_name: indexRow.table_name
        };
        indexDataByName.set(indexRow.index_name, indexData);
        groupedIndexData.push(indexData);
    }
    return groupedIndexData;
}
export default class VelociousDatabaseDriversMssqlTable extends BaseTable {
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     * @param {Record<string, string>} data - Data payload.
     */
    constructor(driver, data) {
        super();
        this.data = data;
        this.driver = driver;
    }
    async getColumns() {
        return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "columns", async () => {
            const result = await this.driver.query(`
        SELECT
          *,
          COLUMNPROPERTY(object_id(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') AS isIdentity
        FROM [INFORMATION_SCHEMA].[COLUMNS]
        WHERE [TABLE_NAME] = ${this.driver.quote(this.getName())}
      `);
            const columns = [];
            for (const data of result) {
                const column = new Column(this, data);
                columns.push(column);
            }
            return columns;
        });
    }
    async getForeignKeys() {
        return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "foreignKeys", async () => {
            const sql = `
        SELECT
            fk.name AS CONSTRAINT_NAME,
            tp.name AS ParentTable,
            ref.name AS ReferencedTable,
            cp.name AS ParentColumn,
            cref.name AS ReferencedColumn,
            tp.name AS TableName
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc
            ON fkc.constraint_object_id = fk.object_id
        INNER JOIN sys.tables tp
            ON fkc.parent_object_id = tp.object_id
        INNER JOIN sys.columns cp
            ON fkc.parent_object_id = cp.object_id
            AND fkc.parent_column_id = cp.column_id
        INNER JOIN sys.tables ref
            ON fkc.referenced_object_id = ref.object_id
        INNER JOIN sys.columns cref
            ON fkc.referenced_object_id = cref.object_id
            AND fkc.referenced_column_id = cref.column_id
        WHERE tp.name = ${this.driver.quote(this.getName())}
        ORDER BY CONSTRAINT_NAME, ParentTable, ReferencedTable;
      `;
            const foreignKeyRows = await this.driver.query(sql);
            const foreignKeys = [];
            for (const foreignKeyRow of foreignKeyRows) {
                const foreignKey = new ForeignKey(foreignKeyRow);
                foreignKeys.push(foreignKey);
            }
            return foreignKeys;
        });
    }
    async getIndexes() {
        return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "indexes", async () => {
            const options = this.getOptions();
            const sql = `
        SELECT
          sys.tables.name AS table_name,
          sys.columns.name AS column_name,
          sys.indexes.name AS index_name,
          sys.indexes.is_unique,
          sys.indexes.is_primary_key
        FROM sys.indexes
        INNER JOIN sys.index_columns ON sys.indexes.object_id = sys.index_columns.object_id AND sys.indexes.index_id = sys.index_columns.index_id
        INNER JOIN sys.columns ON sys.index_columns.object_id = sys.columns.object_id AND sys.index_columns.column_id = sys.columns.column_id
        INNER JOIN sys.tables ON sys.indexes.object_id = sys.tables.object_id
        WHERE
          sys.tables.name = ${options.quote(this.getName())} AND
          sys.index_columns.is_included_column = 0
        ORDER BY
          sys.indexes.name,
          sys.index_columns.key_ordinal
      `;
            const rows = await this.getDriver().query(sql);
            const indexes = [];
            const indexRows = rows.map((row) => normalizeIndexMetadataRow(row));
            for (const indexData of groupMssqlIndexRows(indexRows)) {
                const index = new ColumnsIndex(this, indexData);
                indexes.push(index);
            }
            return indexes;
        });
    }
    /**
     * Runs get name.
     * @returns {string} - The table name.
     */
    getName() {
        return /** @type {string} */ (digg(this.data, "TABLE_NAME"));
    }
    /**
     * Runs truncate.
     * @param {{cascade: boolean}} [args] - Truncate options.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Resolves with the truncate.
     */
    async truncate(args) {
        this.getDriver()._assertNotReadOnly();
        try {
            return await this.getDriver().query(`TRUNCATE TABLE ${this.getOptions().quoteTableName(this.getName())}`);
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith("Query failed 'Cannot truncate table")) {
                // Truncate table is really buggy for some reason - fall back to delete all rows instead
                return await this.getDriver().query(`DELETE FROM ${this.getOptions().quoteTableName(this.getName())}`);
            }
            else {
                throw error;
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9tc3NxbC90YWJsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0sa0JBQWtCLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sYUFBYSxDQUFBO0FBQ2hDLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyxFQUFFLHlCQUF5QixFQUFFLE1BQU0sc0JBQXNCLENBQUE7QUFFaEU7Ozs7Ozs7O0dBUUc7QUFFSDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLG1CQUFtQixDQUFDLFNBQVM7SUFDM0MscURBQXFEO0lBQ3JELE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFDakMsMENBQTBDO0lBQzFDLE1BQU0sZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO0lBRTNCLEtBQUssTUFBTSxRQUFRLElBQUksU0FBUyxFQUFFLENBQUM7UUFDakMsTUFBTSxpQkFBaUIsR0FBRyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVsRSxJQUFJLGlCQUFpQixFQUFFLENBQUM7WUFDdEIsaUJBQWlCLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLENBQUE7WUFDeEQsU0FBUTtRQUNWLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRztZQUNoQixXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO1lBQ25DLFVBQVUsRUFBRSxRQUFRLENBQUMsVUFBVTtZQUMvQixjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWM7WUFDdkMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxTQUFTO1lB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Q0FBQyxDQUFBO1lBQ3hHLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLEtBQUssQ0FBQTtZQUNiLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYXNlVGFibGUgZnJvbSBcIi4uL2Jhc2UtdGFibGUuanNcIlxuaW1wb3J0IENvbHVtbiBmcm9tIFwiLi9jb2x1bW4uanNcIlxuaW1wb3J0IENvbHVtbnNJbmRleCBmcm9tIFwiLi9jb2x1bW5zLWluZGV4LmpzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgRm9yZWlnbktleSBmcm9tIFwiLi9mb3JlaWduLWtleS5qc1wiXG5pbXBvcnQgeyBub3JtYWxpemVJbmRleE1ldGFkYXRhUm93IH0gZnJvbSBcIi4uL2luZGV4LW1ldGFkYXRhLmpzXCJcblxuLyoqXG4gKiBNc3NxbEdyb3VwZWRJbmRleERhdGFUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBNc3NxbEdyb3VwZWRJbmRleERhdGFUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBjb2x1bW5OYW1lcyAtIE9yZGVyZWQgaW5kZXggY29sdW1uIG5hbWVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGluZGV4X25hbWUgLSBJbmRleCBuYW1lLlxuICogQHByb3BlcnR5IHtib29sZWFufSBpc19wcmltYXJ5X2tleSAtIFdoZXRoZXIgdGhlIGluZGV4IGlzIHByaW1hcnkuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzX3VuaXF1ZSAtIFdoZXRoZXIgdGhlIGluZGV4IGlzIHVuaXF1ZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZV9uYW1lIC0gVGFibGUgbmFtZS5cbiAqL1xuXG4vKipcbiAqIEdyb3VwcyBvcmRlcmVkIFNRTCBTZXJ2ZXIgaW5kZXggcm93cyBpbnRvIG9uZSBtZXRhZGF0YSB2YWx1ZSBwZXIgaW5kZXguXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LW1ldGFkYXRhLmpzXCIpLkluZGV4TWV0YWRhdGFUeXBlW119IGluZGV4Um93cyAtIE9yZGVyZWQgaW5kZXggbWV0YWRhdGEgcm93cy5cbiAqIEByZXR1cm5zIHtNc3NxbEdyb3VwZWRJbmRleERhdGFUeXBlW119IC0gR3JvdXBlZCBpbmRleCBtZXRhZGF0YS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdyb3VwTXNzcWxJbmRleFJvd3MoaW5kZXhSb3dzKSB7XG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgTXNzcWxHcm91cGVkSW5kZXhEYXRhVHlwZT59ICovXG4gIGNvbnN0IGluZGV4RGF0YUJ5TmFtZSA9IG5ldyBNYXAoKVxuICAvKiogQHR5cGUge01zc3FsR3JvdXBlZEluZGV4RGF0YVR5cGVbXX0gKi9cbiAgY29uc3QgZ3JvdXBlZEluZGV4RGF0YSA9IFtdXG5cbiAgZm9yIChjb25zdCBpbmRleFJvdyBvZiBpbmRleFJvd3MpIHtcbiAgICBjb25zdCBleGlzdGluZ0luZGV4RGF0YSA9IGluZGV4RGF0YUJ5TmFtZS5nZXQoaW5kZXhSb3cuaW5kZXhfbmFtZSlcblxuICAgIGlmIChleGlzdGluZ0luZGV4RGF0YSkge1xuICAgICAgZXhpc3RpbmdJbmRleERhdGEuY29sdW1uTmFtZXMucHVzaChpbmRleFJvdy5jb2x1bW5fbmFtZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXhEYXRhID0ge1xuICAgICAgY29sdW1uTmFtZXM6IFtpbmRleFJvdy5jb2x1bW5fbmFtZV0sXG4gICAgICBpbmRleF9uYW1lOiBpbmRleFJvdy5pbmRleF9uYW1lLFxuICAgICAgaXNfcHJpbWFyeV9rZXk6IGluZGV4Um93LmlzX3ByaW1hcnlfa2V5LFxuICAgICAgaXNfdW5pcXVlOiBpbmRleFJvdy5pc191bmlxdWUsXG4gICAgICB0YWJsZV9uYW1lOiBpbmRleFJvdy50YWJsZV9uYW1lXG4gICAgfVxuXG4gICAgaW5kZXhEYXRhQnlOYW1lLnNldChpbmRleFJvdy5pbmRleF9uYW1lLCBpbmRleERhdGEpXG4gICAgZ3JvdXBlZEluZGV4RGF0YS5wdXNoKGluZGV4RGF0YSlcbiAgfVxuXG4gIHJldHVybiBncm91cGVkSW5kZXhEYXRhXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc01zc3FsVGFibGUgZXh0ZW5kcyBCYXNlVGFibGUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKi9cbiAgY29uc3RydWN0b3IoZHJpdmVyLCBkYXRhKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuZGF0YSA9IGRhdGFcbiAgICB0aGlzLmRyaXZlciA9IGRyaXZlclxuICB9XG5cbiAgYXN5bmMgZ2V0Q29sdW1ucygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5fY2FjaGVkVGFibGVTY2hlbWFNZXRhZGF0YSh0aGlzLmdldE5hbWUoKSwgXCJjb2x1bW5zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZHJpdmVyLnF1ZXJ5KGBcbiAgICAgICAgU0VMRUNUXG4gICAgICAgICAgKixcbiAgICAgICAgICBDT0xVTU5QUk9QRVJUWShvYmplY3RfaWQoVEFCTEVfU0NIRU1BICsgJy4nICsgVEFCTEVfTkFNRSksIENPTFVNTl9OQU1FLCAnSXNJZGVudGl0eScpIEFTIGlzSWRlbnRpdHlcbiAgICAgICAgRlJPTSBbSU5GT1JNQVRJT05fU0NIRU1BXS5bQ09MVU1OU11cbiAgICAgICAgV0hFUkUgW1RBQkxFX05BTUVdID0gJHt0aGlzLmRyaXZlci5xdW90ZSh0aGlzLmdldE5hbWUoKSl9XG4gICAgICBgKVxuICAgICAgY29uc3QgY29sdW1ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZGF0YSBvZiByZXN1bHQpIHtcbiAgICAgICAgY29uc3QgY29sdW1uID0gbmV3IENvbHVtbih0aGlzLCBkYXRhKVxuXG4gICAgICAgIGNvbHVtbnMucHVzaChjb2x1bW4pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb2x1bW5zXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGdldEZvcmVpZ25LZXlzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLl9jYWNoZWRUYWJsZVNjaGVtYU1ldGFkYXRhKHRoaXMuZ2V0TmFtZSgpLCBcImZvcmVpZ25LZXlzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNxbCA9IGBcbiAgICAgICAgU0VMRUNUXG4gICAgICAgICAgICBmay5uYW1lIEFTIENPTlNUUkFJTlRfTkFNRSxcbiAgICAgICAgICAgIHRwLm5hbWUgQVMgUGFyZW50VGFibGUsXG4gICAgICAgICAgICByZWYubmFtZSBBUyBSZWZlcmVuY2VkVGFibGUsXG4gICAgICAgICAgICBjcC5uYW1lIEFTIFBhcmVudENvbHVtbixcbiAgICAgICAgICAgIGNyZWYubmFtZSBBUyBSZWZlcmVuY2VkQ29sdW1uLFxuICAgICAgICAgICAgdHAubmFtZSBBUyBUYWJsZU5hbWVcbiAgICAgICAgRlJPTSBzeXMuZm9yZWlnbl9rZXlzIGZrXG4gICAgICAgIElOTkVSIEpPSU4gc3lzLmZvcmVpZ25fa2V5X2NvbHVtbnMgZmtjXG4gICAgICAgICAgICBPTiBma2MuY29uc3RyYWludF9vYmplY3RfaWQgPSBmay5vYmplY3RfaWRcbiAgICAgICAgSU5ORVIgSk9JTiBzeXMudGFibGVzIHRwXG4gICAgICAgICAgICBPTiBma2MucGFyZW50X29iamVjdF9pZCA9IHRwLm9iamVjdF9pZFxuICAgICAgICBJTk5FUiBKT0lOIHN5cy5jb2x1bW5zIGNwXG4gICAgICAgICAgICBPTiBma2MucGFyZW50X29iamVjdF9pZCA9IGNwLm9iamVjdF9pZFxuICAgICAgICAgICAgQU5EIGZrYy5wYXJlbnRfY29sdW1uX2lkID0gY3AuY29sdW1uX2lkXG4gICAgICAgIElOTkVSIEpPSU4gc3lzLnRhYmxlcyByZWZcbiAgICAgICAgICAgIE9OIGZrYy5yZWZlcmVuY2VkX29iamVjdF9pZCA9IHJlZi5vYmplY3RfaWRcbiAgICAgICAgSU5ORVIgSk9JTiBzeXMuY29sdW1ucyBjcmVmXG4gICAgICAgICAgICBPTiBma2MucmVmZXJlbmNlZF9vYmplY3RfaWQgPSBjcmVmLm9iamVjdF9pZFxuICAgICAgICAgICAgQU5EIGZrYy5yZWZlcmVuY2VkX2NvbHVtbl9pZCA9IGNyZWYuY29sdW1uX2lkXG4gICAgICAgIFdIRVJFIHRwLm5hbWUgPSAke3RoaXMuZHJpdmVyLnF1b3RlKHRoaXMuZ2V0TmFtZSgpKX1cbiAgICAgICAgT1JERVIgQlkgQ09OU1RSQUlOVF9OQU1FLCBQYXJlbnRUYWJsZSwgUmVmZXJlbmNlZFRhYmxlO1xuICAgICAgYFxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5Um93cyA9IGF3YWl0IHRoaXMuZHJpdmVyLnF1ZXJ5KHNxbClcbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlzID0gW11cblxuICAgICAgZm9yIChjb25zdCBmb3JlaWduS2V5Um93IG9mIGZvcmVpZ25LZXlSb3dzKSB7XG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBuZXcgRm9yZWlnbktleShmb3JlaWduS2V5Um93KVxuXG4gICAgICAgIGZvcmVpZ25LZXlzLnB1c2goZm9yZWlnbktleSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGZvcmVpZ25LZXlzXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGdldEluZGV4ZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuX2NhY2hlZFRhYmxlU2NoZW1hTWV0YWRhdGEodGhpcy5nZXROYW1lKCksIFwiaW5kZXhlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICAgIGNvbnN0IHNxbCA9IGBcbiAgICAgICAgU0VMRUNUXG4gICAgICAgICAgc3lzLnRhYmxlcy5uYW1lIEFTIHRhYmxlX25hbWUsXG4gICAgICAgICAgc3lzLmNvbHVtbnMubmFtZSBBUyBjb2x1bW5fbmFtZSxcbiAgICAgICAgICBzeXMuaW5kZXhlcy5uYW1lIEFTIGluZGV4X25hbWUsXG4gICAgICAgICAgc3lzLmluZGV4ZXMuaXNfdW5pcXVlLFxuICAgICAgICAgIHN5cy5pbmRleGVzLmlzX3ByaW1hcnlfa2V5XG4gICAgICAgIEZST00gc3lzLmluZGV4ZXNcbiAgICAgICAgSU5ORVIgSk9JTiBzeXMuaW5kZXhfY29sdW1ucyBPTiBzeXMuaW5kZXhlcy5vYmplY3RfaWQgPSBzeXMuaW5kZXhfY29sdW1ucy5vYmplY3RfaWQgQU5EIHN5cy5pbmRleGVzLmluZGV4X2lkID0gc3lzLmluZGV4X2NvbHVtbnMuaW5kZXhfaWRcbiAgICAgICAgSU5ORVIgSk9JTiBzeXMuY29sdW1ucyBPTiBzeXMuaW5kZXhfY29sdW1ucy5vYmplY3RfaWQgPSBzeXMuY29sdW1ucy5vYmplY3RfaWQgQU5EIHN5cy5pbmRleF9jb2x1bW5zLmNvbHVtbl9pZCA9IHN5cy5jb2x1bW5zLmNvbHVtbl9pZFxuICAgICAgICBJTk5FUiBKT0lOIHN5cy50YWJsZXMgT04gc3lzLmluZGV4ZXMub2JqZWN0X2lkID0gc3lzLnRhYmxlcy5vYmplY3RfaWRcbiAgICAgICAgV0hFUkVcbiAgICAgICAgICBzeXMudGFibGVzLm5hbWUgPSAke29wdGlvbnMucXVvdGUodGhpcy5nZXROYW1lKCkpfSBBTkRcbiAgICAgICAgICBzeXMuaW5kZXhfY29sdW1ucy5pc19pbmNsdWRlZF9jb2x1bW4gPSAwXG4gICAgICAgIE9SREVSIEJZXG4gICAgICAgICAgc3lzLmluZGV4ZXMubmFtZSxcbiAgICAgICAgICBzeXMuaW5kZXhfY29sdW1ucy5rZXlfb3JkaW5hbFxuICAgICAgYFxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5xdWVyeShzcWwpXG4gICAgICBjb25zdCBpbmRleGVzID0gW11cbiAgICAgIGNvbnN0IGluZGV4Um93cyA9IHJvd3MubWFwKChyb3cpID0+IG5vcm1hbGl6ZUluZGV4TWV0YWRhdGFSb3cocm93KSlcblxuICAgICAgZm9yIChjb25zdCBpbmRleERhdGEgb2YgZ3JvdXBNc3NxbEluZGV4Um93cyhpbmRleFJvd3MpKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gbmV3IENvbHVtbnNJbmRleCh0aGlzLCBpbmRleERhdGEpXG5cbiAgICAgICAgaW5kZXhlcy5wdXNoKGluZGV4KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gaW5kZXhlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGFibGUgbmFtZS5cbiAgICovXG4gIGdldE5hbWUoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoZGlnZyh0aGlzLmRhdGEsIFwiVEFCTEVfTkFNRVwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlLlxuICAgKiBAcGFyYW0ge3tjYXNjYWRlOiBib29sZWFufX0gW2FyZ3NdIC0gVHJ1bmNhdGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdHJ1bmNhdGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZShhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aGlzLmdldERyaXZlcigpLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KGBUUlVOQ0FURSBUQUJMRSAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRoaXMuZ2V0TmFtZSgpKX1gKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoXCJRdWVyeSBmYWlsZWQgJ0Nhbm5vdCB0cnVuY2F0ZSB0YWJsZVwiKSkge1xuICAgICAgICAvLyBUcnVuY2F0ZSB0YWJsZSBpcyByZWFsbHkgYnVnZ3kgZm9yIHNvbWUgcmVhc29uIC0gZmFsbCBiYWNrIHRvIGRlbGV0ZSBhbGwgcm93cyBpbnN0ZWFkXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KGBERUxFVEUgRlJPTSAke3RoaXMuZ2V0T3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRoaXMuZ2V0TmFtZSgpKX1gKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==