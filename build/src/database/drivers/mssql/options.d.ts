import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversMssqlOptions extends QueryParserOptions {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     */
    constructor({ driver }: {
        driver: import("../base.js").default;
    });
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} string - String.
     * @returns {number | string} - The quote.
     */
    quote(string: ReturnType<typeof JSON.parse>): number | string;
    /**
     * Runs quote column name.
     * @param {string} string - String.
     * @returns {string} - The quote column name.
     */
    quoteColumnName(string: string): string;
    /**
     * Runs quote database name.
     * @param {string} databaseName - Database name.
     * @returns {string} - The quote database name.
     */
    quoteDatabaseName(databaseName: string): string;
    /**
     * Runs quote index name.
     * @param {string} string - String.
     * @returns {string} - The quote index name.
     */
    quoteIndexName(string: string): string;
    /**
     * Runs quote table name.
     * @param {string} string - String.
     * @returns {string} - The quote table name.
     */
    quoteTableName(string: string): string;
}
//# sourceMappingURL=options.d.ts.map