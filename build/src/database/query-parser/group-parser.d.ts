export default class VelociousDatabaseQueryParserFromParser {
    pretty: boolean;
    query: import("../query/index.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} args.pretty - Whether pretty.
     * @param {import("../query/index.js").default} args.query - Query instance.
     */
    constructor({ pretty, query, ...restArgs }: {
        pretty: boolean;
        query: import("../query/index.js").default;
    });
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql(): string;
}
//# sourceMappingURL=group-parser.d.ts.map