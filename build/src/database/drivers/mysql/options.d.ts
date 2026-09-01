import QueryParserOptions from "../../query-parser/options.js";
export default class VelociousDatabaseDriversMysqlOptions extends QueryParserOptions {
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
}
//# sourceMappingURL=options.d.ts.map