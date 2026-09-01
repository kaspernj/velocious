export default class VelocuiousDatabaseQueryParserJoinsParser {
    pretty: boolean;
    query: import("../query/index.js").default;
    conn: import("../drivers/base.js").default;
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
//# sourceMappingURL=joins-parser.d.ts.map