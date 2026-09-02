export default class VelociousDatabaseQueryFromBase {
    /**
     * Query.
     * @type {import("./index.js").default  | null} */
    query: import("./index.js").default | null;
    /**
     * Runs set query.
     * @param {import("./index.js").default} query - Query instance.
     * @returns {void} - No return value.
     */
    setQuery(query: import("./index.js").default): void;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs to sql.
     * @abstract
     * @returns {string[]} - SQL statements.
     */
    toSql(): string[];
}
//# sourceMappingURL=from-base.d.ts.map