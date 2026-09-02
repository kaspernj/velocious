import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversPgsqlOptions extends QueryParserOptions {
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     */
    constructor(driver: import("../base.js").default);
    /**
     * Runs quote.
     * @param {string} string - String.
     * @returns {number | string} - The quote.
     */
    quote(string: string): number | string;
}
//# sourceMappingURL=options.d.ts.map