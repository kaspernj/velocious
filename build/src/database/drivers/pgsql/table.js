// @ts-check
import BaseTable from "../base-table.js";
import Column from "./column.js";
import ColumnsIndex from "./columns-index.js";
import ForeignKey from "./foreign-key.js";
import { normalizeIndexMetadataRow } from "../index-metadata.js";
/**
 * PgsqlGroupedIndexDataType type.
 * @typedef {object} PgsqlGroupedIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */
/**
 * Groups ordered PostgreSQL index rows into one metadata value per index.
 * @param {import("../index-metadata.js").IndexMetadataType[]} indexRows - Ordered index metadata rows.
 * @returns {PgsqlGroupedIndexDataType[]} - Grouped index metadata.
 */
export function groupPgsqlIndexRows(indexRows) {
    /** @type {Map<string, PgsqlGroupedIndexDataType>} */
    const indexDataByName = new Map();
    /** @type {PgsqlGroupedIndexDataType[]} */
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
export default class VelociousDatabaseDriversPgsqlTable extends BaseTable {
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
          columns.*,
          CASE WHEN key_column_usage.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
          col_description((columns.table_schema || '.' || columns.table_name)::regclass, columns.ordinal_position) AS column_comment

        FROM
          information_schema.columns AS columns

        LEFT JOIN information_schema.table_constraints AS table_constraints ON
          table_constraints.table_name = columns.table_name AND
          table_constraints.table_schema = columns.table_schema AND
          table_constraints.constraint_type = 'PRIMARY KEY'

        LEFT JOIN information_schema.key_column_usage AS key_column_usage ON
          key_column_usage.constraint_name = table_constraints.constraint_name AND
          key_column_usage.table_schema = table_constraints.table_schema AND
          key_column_usage.table_name = columns.table_name AND
          key_column_usage.column_name = columns.column_name

        WHERE
          columns.table_catalog = CURRENT_DATABASE() AND
          columns.table_schema = 'public' AND
          columns.table_name = '${this.getName()}'
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
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name

        FROM
          information_schema.table_constraints AS tc

        JOIN information_schema.key_column_usage AS kcu ON
          tc.constraint_name = kcu.constraint_name

        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name

        WHERE
          constraint_type = 'FOREIGN KEY' AND
          tc.table_catalog = CURRENT_DATABASE() AND
          tc.table_name = ${this.getDriver().quote(this.getName())}
      `;
            const foreignKeyRows = await this.getDriver().query(sql);
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
            const indexesRows = await this.getDriver().query(`
        SELECT
          index_attribute.attname AS column_name,
          pg_index.indexrelid::regclass AS index_name,
          pg_class.relname AS table_name,
          pg_index.indisprimary AS is_primary_key,
          pg_index.indisunique AS is_unique
        FROM pg_index
        JOIN pg_class ON pg_class.oid = pg_index.indrelid
        JOIN LATERAL unnest(pg_index.indkey) WITH ORDINALITY AS index_columns(attribute_number, ordinal_position) ON true
        JOIN pg_attribute AS index_attribute ON index_attribute.attrelid = pg_class.oid AND index_attribute.attnum = index_columns.attribute_number
        WHERE
          pg_class.relname = ${options.quote(this.getName())} AND
          index_columns.ordinal_position <= pg_index.indnkeyatts
        ORDER BY
          pg_index.indexrelid,
          index_columns.ordinal_position
      `);
            const indexes = [];
            const indexRows = indexesRows.map((indexRow) => normalizeIndexMetadataRow(indexRow));
            for (const indexData of groupPgsqlIndexRows(indexRows)) {
                const columnsIndex = new ColumnsIndex(this, indexData);
                indexes.push(columnsIndex);
            }
            return indexes;
        });
    }
    /**
     * Runs get name.
     * @returns {string} - The table name.
     */
    getName() {
        return this.data.table_name;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9wZ3NxbC90YWJsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxTQUFTLE1BQU0sa0JBQWtCLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sYUFBYSxDQUFBO0FBQ2hDLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxNQUFNLHNCQUFzQixDQUFBO0FBRWhFOzs7Ozs7OztHQVFHO0FBRUg7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxtQkFBbUIsQ0FBQyxTQUFTO0lBQzNDLHFEQUFxRDtJQUNyRCxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQ2pDLDBDQUEwQztJQUMxQyxNQUFNLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtJQUUzQixLQUFLLE1BQU0sUUFBUSxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQ2pDLE1BQU0saUJBQWlCLEdBQUcsZUFBZSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFbEUsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQ3RCLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1lBQ3hELFNBQVE7UUFDVixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUc7WUFDaEIsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQztZQUNuQyxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVU7WUFDL0IsY0FBYyxFQUFFLFFBQVEsQ0FBQyxjQUFjO1lBQ3ZDLFNBQVMsRUFBRSxRQUFRLENBQUMsU0FBUztZQUM3QixVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVU7U0FDaEMsQ0FBQTtR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S0FBSyxNQUFNLFNBQVMsSUFBSSxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO2dCQUN2RCxNQUFNLFlBQVksR0FBRyxJQUFJLFlBQVksQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUE7Z0JBRXRELE9BQU8sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUE7WUFDNUIsQ0FBQztZQUVELE9BQU8sT0FBTyxDQUFBO1FBQ2hCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU87UUFDTCxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFBO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZVRhYmxlIGZyb20gXCIuLi9iYXNlLXRhYmxlLmpzXCJcbmltcG9ydCBDb2x1bW4gZnJvbSBcIi4vY29sdW1uLmpzXCJcbmltcG9ydCBDb2x1bW5zSW5kZXggZnJvbSBcIi4vY29sdW1ucy1pbmRleC5qc1wiXG5pbXBvcnQgRm9yZWlnbktleSBmcm9tIFwiLi9mb3JlaWduLWtleS5qc1wiXG5pbXBvcnQgeyBub3JtYWxpemVJbmRleE1ldGFkYXRhUm93IH0gZnJvbSBcIi4uL2luZGV4LW1ldGFkYXRhLmpzXCJcblxuLyoqXG4gKiBQZ3NxbEdyb3VwZWRJbmRleERhdGFUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQZ3NxbEdyb3VwZWRJbmRleERhdGFUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBjb2x1bW5OYW1lcyAtIE9yZGVyZWQgaW5kZXggY29sdW1uIG5hbWVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGluZGV4X25hbWUgLSBJbmRleCBuYW1lLlxuICogQHByb3BlcnR5IHtib29sZWFufSBpc19wcmltYXJ5X2tleSAtIFdoZXRoZXIgdGhlIGluZGV4IGlzIHByaW1hcnkuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzX3VuaXF1ZSAtIFdoZXRoZXIgdGhlIGluZGV4IGlzIHVuaXF1ZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZV9uYW1lIC0gVGFibGUgbmFtZS5cbiAqL1xuXG4vKipcbiAqIEdyb3VwcyBvcmRlcmVkIFBvc3RncmVTUUwgaW5kZXggcm93cyBpbnRvIG9uZSBtZXRhZGF0YSB2YWx1ZSBwZXIgaW5kZXguXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LW1ldGFkYXRhLmpzXCIpLkluZGV4TWV0YWRhdGFUeXBlW119IGluZGV4Um93cyAtIE9yZGVyZWQgaW5kZXggbWV0YWRhdGEgcm93cy5cbiAqIEByZXR1cm5zIHtQZ3NxbEdyb3VwZWRJbmRleERhdGFUeXBlW119IC0gR3JvdXBlZCBpbmRleCBtZXRhZGF0YS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdyb3VwUGdzcWxJbmRleFJvd3MoaW5kZXhSb3dzKSB7XG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUGdzcWxHcm91cGVkSW5kZXhEYXRhVHlwZT59ICovXG4gIGNvbnN0IGluZGV4RGF0YUJ5TmFtZSA9IG5ldyBNYXAoKVxuICAvKiogQHR5cGUge1Bnc3FsR3JvdXBlZEluZGV4RGF0YVR5cGVbXX0gKi9cbiAgY29uc3QgZ3JvdXBlZEluZGV4RGF0YSA9IFtdXG5cbiAgZm9yIChjb25zdCBpbmRleFJvdyBvZiBpbmRleFJvd3MpIHtcbiAgICBjb25zdCBleGlzdGluZ0luZGV4RGF0YSA9IGluZGV4RGF0YUJ5TmFtZS5nZXQoaW5kZXhSb3cuaW5kZXhfbmFtZSlcblxuICAgIGlmIChleGlzdGluZ0luZGV4RGF0YSkge1xuICAgICAgZXhpc3RpbmdJbmRleERhdGEuY29sdW1uTmFtZXMucHVzaChpbmRleFJvdy5jb2x1bW5fbmFtZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXhEYXRhID0ge1xuICAgICAgY29sdW1uTmFtZXM6IFtpbmRleFJvdy5jb2x1bW5fbmFtZV0sXG4gICAgICBpbmRleF9uYW1lOiBpbmRleFJvdy5pbmRleF9uYW1lLFxuICAgICAgaXNfcHJpbWFyeV9rZXk6IGluZGV4Um93LmlzX3ByaW1hcnlfa2V5LFxuICAgICAgaXNfdW5pcXVlOiBpbmRleFJvdy5pc191bmlxdWUsXG4gICAgICB0YWJsZV9uYW1lOiBpbmRleFJvdy50YWJsZV9uYW1lXG4gICAgfVxuXG4gICAgaW5kZXhEYXRhQnlOYW1lLnNldChpbmRleFJvdy5pbmRleF9uYW1lLCBpbmRleERhdGEpXG4gICAgZ3JvdXBlZEluZGV4RGF0YS5wdXNoKGluZGV4RGF0YSlcbiAgfVxuXG4gIHJldHVybiBncm91cGVkSW5kZXhEYXRhXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1Bnc3FsVGFibGUgZXh0ZW5kcyBCYXNlVGFibGUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGRyaXZlciAtIERhdGFiYXNlIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKi9cbiAgY29uc3RydWN0b3IoZHJpdmVyLCBkYXRhKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuZGF0YSA9IGRhdGFcbiAgICB0aGlzLmRyaXZlciA9IGRyaXZlclxuICB9XG5cbiAgYXN5bmMgZ2V0Q29sdW1ucygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREcml2ZXIoKS5fY2FjaGVkVGFibGVTY2hlbWFNZXRhZGF0YSh0aGlzLmdldE5hbWUoKSwgXCJjb2x1bW5zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZHJpdmVyLnF1ZXJ5KGBcbiAgICAgICAgU0VMRUNUXG4gICAgICAgICAgY29sdW1ucy4qLFxuICAgICAgICAgIENBU0UgV0hFTiBrZXlfY29sdW1uX3VzYWdlLmNvbHVtbl9uYW1lIElTIE5PVCBOVUxMIFRIRU4gMSBFTFNFIDAgRU5EIEFTIGlzX3ByaW1hcnlfa2V5LFxuICAgICAgICAgIGNvbF9kZXNjcmlwdGlvbigoY29sdW1ucy50YWJsZV9zY2hlbWEgfHwgJy4nIHx8IGNvbHVtbnMudGFibGVfbmFtZSk6OnJlZ2NsYXNzLCBjb2x1bW5zLm9yZGluYWxfcG9zaXRpb24pIEFTIGNvbHVtbl9jb21tZW50XG5cbiAgICAgICAgRlJPTVxuICAgICAgICAgIGluZm9ybWF0aW9uX3NjaGVtYS5jb2x1bW5zIEFTIGNvbHVtbnNcblxuICAgICAgICBMRUZUIEpPSU4gaW5mb3JtYXRpb25fc2NoZW1hLnRhYmxlX2NvbnN0cmFpbnRzIEFTIHRhYmxlX2NvbnN0cmFpbnRzIE9OXG4gICAgICAgICAgdGFibGVfY29uc3RyYWludHMudGFibGVfbmFtZSA9IGNvbHVtbnMudGFibGVfbmFtZSBBTkRcbiAgICAgICAgICB0YWJsZV9jb25zdHJhaW50cy50YWJsZV9zY2hlbWEgPSBjb2x1bW5zLnRhYmxlX3NjaGVtYSBBTkRcbiAgICAgICAgICB0YWJsZV9jb25zdHJhaW50cy5jb25zdHJhaW50X3R5cGUgPSAnUFJJTUFSWSBLRVknXG5cbiAgICAgICAgTEVGVCBKT0lOIGluZm9ybWF0aW9uX3NjaGVtYS5rZXlfY29sdW1uX3VzYWdlIEFTIGtleV9jb2x1bW5fdXNhZ2UgT05cbiAgICAgICAgICBrZXlfY29sdW1uX3VzYWdlLmNvbnN0cmFpbnRfbmFtZSA9IHRhYmxlX2NvbnN0cmFpbnRzLmNvbnN0cmFpbnRfbmFtZSBBTkRcbiAgICAgICAgICBrZXlfY29sdW1uX3VzYWdlLnRhYmxlX3NjaGVtYSA9IHRhYmxlX2NvbnN0cmFpbnRzLnRhYmxlX3NjaGVtYSBBTkRcbiAgICAgICAgICBrZXlfY29sdW1uX3VzYWdlLnRhYmxlX25hbWUgPSBjb2x1bW5zLnRhYmxlX25hbWUgQU5EXG4gICAgICAgICAga2V5X2NvbHVtbl91c2FnZS5jb2x1bW5fbmFtZSA9IGNvbHVtbnMuY29sdW1uX25hbWVcblxuICAgICAgICBXSEVSRVxuICAgICAgICAgIGNvbHVtbnMudGFibGVfY2F0YWxvZyA9IENVUlJFTlRfREFUQUJBU0UoKSBBTkRcbiAgICAgICAgICBjb2x1bW5zLnRhYmxlX3NjaGVtYSA9ICdwdWJsaWMnIEFORFxuICAgICAgICAgIGNvbHVtbnMudGFibGVfbmFtZSA9ICcke3RoaXMuZ2V0TmFtZSgpfSdcbiAgICAgIGApXG4gICAgICBjb25zdCBjb2x1bW5zID0gW11cblxuICAgICAgZm9yIChjb25zdCBkYXRhIG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCBjb2x1bW4gPSBuZXcgQ29sdW1uKHRoaXMsIGRhdGEpXG5cbiAgICAgICAgY29sdW1ucy5wdXNoKGNvbHVtbilcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvbHVtbnNcbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgZ2V0Rm9yZWlnbktleXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuX2NhY2hlZFRhYmxlU2NoZW1hTWV0YWRhdGEodGhpcy5nZXROYW1lKCksIFwiZm9yZWlnbktleXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3FsID0gYFxuICAgICAgICBTRUxFQ1RcbiAgICAgICAgICB0Yy5jb25zdHJhaW50X25hbWUsXG4gICAgICAgICAgdGMudGFibGVfbmFtZSxcbiAgICAgICAgICBrY3UuY29sdW1uX25hbWUsXG4gICAgICAgICAgY2N1LnRhYmxlX25hbWUgQVMgZm9yZWlnbl90YWJsZV9uYW1lLFxuICAgICAgICAgIGNjdS5jb2x1bW5fbmFtZSBBUyBmb3JlaWduX2NvbHVtbl9uYW1lXG5cbiAgICAgICAgRlJPTVxuICAgICAgICAgIGluZm9ybWF0aW9uX3NjaGVtYS50YWJsZV9jb25zdHJhaW50cyBBUyB0Y1xuXG4gICAgICAgIEpPSU4gaW5mb3JtYXRpb25fc2NoZW1hLmtleV9jb2x1bW5fdXNhZ2UgQVMga2N1IE9OXG4gICAgICAgICAgdGMuY29uc3RyYWludF9uYW1lID0ga2N1LmNvbnN0cmFpbnRfbmFtZVxuXG4gICAgICAgIEpPSU4gaW5mb3JtYXRpb25fc2NoZW1hLmNvbnN0cmFpbnRfY29sdW1uX3VzYWdlIEFTIGNjdVxuICAgICAgICAgIE9OIGNjdS5jb25zdHJhaW50X25hbWUgPSB0Yy5jb25zdHJhaW50X25hbWVcblxuICAgICAgICBXSEVSRVxuICAgICAgICAgIGNvbnN0cmFpbnRfdHlwZSA9ICdGT1JFSUdOIEtFWScgQU5EXG4gICAgICAgICAgdGMudGFibGVfY2F0YWxvZyA9IENVUlJFTlRfREFUQUJBU0UoKSBBTkRcbiAgICAgICAgICB0Yy50YWJsZV9uYW1lID0gJHt0aGlzLmdldERyaXZlcigpLnF1b3RlKHRoaXMuZ2V0TmFtZSgpKX1cbiAgICAgIGBcblxuICAgICAgY29uc3QgZm9yZWlnbktleVJvd3MgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KHNxbClcbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlzID0gW11cblxuICAgICAgZm9yIChjb25zdCBmb3JlaWduS2V5Um93IG9mIGZvcmVpZ25LZXlSb3dzKSB7XG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBuZXcgRm9yZWlnbktleShmb3JlaWduS2V5Um93KVxuXG4gICAgICAgIGZvcmVpZ25LZXlzLnB1c2goZm9yZWlnbktleSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGZvcmVpZ25LZXlzXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGdldEluZGV4ZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RHJpdmVyKCkuX2NhY2hlZFRhYmxlU2NoZW1hTWV0YWRhdGEodGhpcy5nZXROYW1lKCksIFwiaW5kZXhlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcblxuICAgICAgY29uc3QgaW5kZXhlc1Jvd3MgPSBhd2FpdCB0aGlzLmdldERyaXZlcigpLnF1ZXJ5KGBcbiAgICAgICAgU0VMRUNUXG4gICAgICAgICAgaW5kZXhfYXR0cmlidXRlLmF0dG5hbWUgQVMgY29sdW1uX25hbWUsXG4gICAgICAgICAgcGdfaW5kZXguaW5kZXhyZWxpZDo6cmVnY2xhc3MgQVMgaW5kZXhfbmFtZSxcbiAgICAgICAgICBwZ19jbGFzcy5yZWxuYW1lIEFTIHRhYmxlX25hbWUsXG4gICAgICAgICAgcGdfaW5kZXguaW5kaXNwcmltYXJ5IEFTIGlzX3ByaW1hcnlfa2V5LFxuICAgICAgICAgIHBnX2luZGV4LmluZGlzdW5pcXVlIEFTIGlzX3VuaXF1ZVxuICAgICAgICBGUk9NIHBnX2luZGV4XG4gICAgICAgIEpPSU4gcGdfY2xhc3MgT04gcGdfY2xhc3Mub2lkID0gcGdfaW5kZXguaW5kcmVsaWRcbiAgICAgICAgSk9JTiBMQVRFUkFMIHVubmVzdChwZ19pbmRleC5pbmRrZXkpIFdJVEggT1JESU5BTElUWSBBUyBpbmRleF9jb2x1bW5zKGF0dHJpYnV0ZV9udW1iZXIsIG9yZGluYWxfcG9zaXRpb24pIE9OIHRydWVcbiAgICAgICAgSk9JTiBwZ19hdHRyaWJ1dGUgQVMgaW5kZXhfYXR0cmlidXRlIE9OIGluZGV4X2F0dHJpYnV0ZS5hdHRyZWxpZCA9IHBnX2NsYXNzLm9pZCBBTkQgaW5kZXhfYXR0cmlidXRlLmF0dG51bSA9IGluZGV4X2NvbHVtbnMuYXR0cmlidXRlX251bWJlclxuICAgICAgICBXSEVSRVxuICAgICAgICAgIHBnX2NsYXNzLnJlbG5hbWUgPSAke29wdGlvbnMucXVvdGUodGhpcy5nZXROYW1lKCkpfSBBTkRcbiAgICAgICAgICBpbmRleF9jb2x1bW5zLm9yZGluYWxfcG9zaXRpb24gPD0gcGdfaW5kZXguaW5kbmtleWF0dHNcbiAgICAgICAgT1JERVIgQllcbiAgICAgICAgICBwZ19pbmRleC5pbmRleHJlbGlkLFxuICAgICAgICAgIGluZGV4X2NvbHVtbnMub3JkaW5hbF9wb3NpdGlvblxuICAgICAgYClcblxuICAgICAgY29uc3QgaW5kZXhlcyA9IFtdXG5cbiAgICAgIGNvbnN0IGluZGV4Um93cyA9IGluZGV4ZXNSb3dzLm1hcCgoaW5kZXhSb3cpID0+IG5vcm1hbGl6ZUluZGV4TWV0YWRhdGFSb3coaW5kZXhSb3cpKVxuXG4gICAgICBmb3IgKGNvbnN0IGluZGV4RGF0YSBvZiBncm91cFBnc3FsSW5kZXhSb3dzKGluZGV4Um93cykpIHtcbiAgICAgICAgY29uc3QgY29sdW1uc0luZGV4ID0gbmV3IENvbHVtbnNJbmRleCh0aGlzLCBpbmRleERhdGEpXG5cbiAgICAgICAgaW5kZXhlcy5wdXNoKGNvbHVtbnNJbmRleClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGluZGV4ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBnZXROYW1lKCkge1xuICAgIHJldHVybiB0aGlzLmRhdGEudGFibGVfbmFtZVxuICB9XG59XG4iXX0=