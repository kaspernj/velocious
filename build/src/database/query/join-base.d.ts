export default class VelociousDatabaseQueryJoinBase {
    query: import("./index.js").default | undefined;
    pretty: boolean;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs get query.
     * @returns {import("./index.js").default} - The query.
     */
    getQuery(): import("./index.js").default;
    /**
     * Runs set pretty.
     * @param {boolean} value - Value to use.
     */
    setPretty(value: boolean): void;
    /**
     * Runs set query.
     * @param {import("./index.js").default} query - Query instance.
     */
    setQuery(query: import("./index.js").default): void;
    toSql(): void;
}
//# sourceMappingURL=join-base.d.ts.map