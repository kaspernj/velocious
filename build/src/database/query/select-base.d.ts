export default class VelociousDatabaseQuerySelectBase {
    query: import("./index.js").default | undefined;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs set query.
     * @param {import("./index.js").default} query - Query instance.
     */
    setQuery(query: import("./index.js").default): void;
    /**
     * Runs to sql.
     * @abstract
     * @returns {string} - SQL string.
     */
    toSql(): string;
}
//# sourceMappingURL=select-base.d.ts.map