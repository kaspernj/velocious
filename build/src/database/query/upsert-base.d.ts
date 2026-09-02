export default class VelociousDatabaseQueryUpsertBase {
    conflictColumns: string[];
    data: Record<string, any>;
    driver: import("../drivers/base.js").default;
    tableName: string;
    updateColumns: string[];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Array<string>} args.conflictColumns - Columns that identify duplicates.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.data - Data payload.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {Array<string>} args.updateColumns - Columns to update on conflict.
     * @param {string} args.tableName - Table name.
     */
    constructor({ conflictColumns, data, driver, tableName, updateColumns, ...restArgs }: {
        conflictColumns: Array<string>;
        data: Record<string, ReturnType<typeof JSON.parse>>;
        driver: import("../drivers/base.js").default;
        updateColumns: Array<string>;
        tableName: string;
    });
    /**
     * Runs data columns.
     * @returns {Array<string>} - Column names from the data payload.
     */
    dataColumns(): Array<string>;
    /**
     * Runs format column value.
     * @param {string} columnName - Column name.
     * @returns {string | number} - SQL literal.
     */
    formatColumnValue(columnName: string): string | number;
    /**
     * Runs format value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to format.
     * @returns {string | number} - SQL literal.
     */
    formatValue(value: ReturnType<typeof JSON.parse>): string | number;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - Driver options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs quoted column.
     * @param {string} columnName - Column name.
     * @returns {string} - Quoted column name.
     */
    quotedColumn(columnName: string): string;
    /**
     * Runs quoted insert columns sql.
     * @returns {string} - Comma-separated quoted insert columns.
     */
    quotedInsertColumnsSql(): string;
    /**
     * Runs quoted insert values sql.
     * @returns {string} - Comma-separated formatted insert values.
     */
    quotedInsertValuesSql(): string;
    /**
     * Runs quoted table name.
     * @returns {string} - Quoted table name.
     */
    quotedTableName(): string;
    toSql(): void;
}
//# sourceMappingURL=upsert-base.d.ts.map