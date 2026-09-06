export default class VelociousDatabaseQuerySelectBase {
    query: import("./index.js").default | undefined;
    /**
     * Returns the explicit result alias carried by this select.
     * @param {{getType: () => string}} _driver - Driver that determines returned identifier spelling.
     * @returns {string | undefined} - Selected result alias, or undefined when the select has none.
     */
    getAlias(_driver: {
        getType: () => string;
    }): string | undefined;
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