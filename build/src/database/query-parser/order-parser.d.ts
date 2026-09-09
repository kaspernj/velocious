export default class VelocuiousDatabaseQueryParserOrderParser {
    pretty: boolean;
    query: import("../query/index.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} args.pretty - Whether pretty.
     * @param {import("../query/index.js").default} args.query - Query instance.
     */
    constructor({ pretty, query }: {
        pretty: boolean;
        query: import("../query/index.js").default;
    });
    toSql(): string;
}
//# sourceMappingURL=order-parser.d.ts.map