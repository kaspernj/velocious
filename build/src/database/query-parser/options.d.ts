export type OptionsObjectArgsType = {
    /**
     * - Quote character for column names.
     */
    columnQuote: string;
    /**
     * - Quote character for index names.
     */
    indexQuote: string;
    /**
     * - Database driver instance.
     */
    driver: import("../drivers/base.js").default;
    /**
     * - Quote character for table names.
     */
    tableQuote: string;
    /**
     * - Quote character for string literals.
     */
    stringQuote: string;
};
/**
 * OptionsObjectArgsType type.
 * @typedef {object} OptionsObjectArgsType
 * @property {string} columnQuote - Quote character for column names.
 * @property {string} indexQuote - Quote character for index names.
 * @property {import("../drivers/base.js").default} driver - Database driver instance.
 * @property {string} tableQuote - Quote character for table names.
 * @property {string} stringQuote - Quote character for string literals.
 */
export default class VelociousDatabaseQueryParserOptions {
    columnQuote: string;
    indexQuote: string;
    driver: import("../drivers/base.js").default;
    tableQuote: string;
    stringQuote: string;
    /**
     * Runs constructor.
     * @param {OptionsObjectArgsType} options - Options object.
     */
    constructor(options: OptionsObjectArgsType);
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {number | string} - The quote.
     */
    quote(value: ReturnType<typeof JSON.parse>): number | string;
    /**
     * Runs quote database name.
     * @param {string} databaseName - Database name.
     * @returns {string} - The quote database name.
     */
    quoteDatabaseName(databaseName: string): string;
    /**
     * Runs quote column name.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote column name.
     */
    quoteColumnName(columnName: string): string;
    /**
     * Runs quote index name.
     * @param {string} indexName - Index name.
     * @returns {string} - The quote index name.
     */
    quoteIndexName(indexName: string): string;
    /**
     * Runs quote string.
     * @abstract
     * @param {ReturnType<typeof JSON.parse>} string - String.
     * @returns {string} - The quote string.
     */
    quoteString(string: ReturnType<typeof JSON.parse>): string;
    /**
     * Runs quote table name.
     * @param {string} tableName - Table name.
     * @returns {string} - The quote table name.
     */
    quoteTableName(tableName: string): string;
}
//# sourceMappingURL=options.d.ts.map