export default class VelociousDatabaseQueryBase {
    _driver: import("../drivers/base.js").default;
    _options: import("../query-parser/options.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {import("../query-parser/options.js").default} [args.options] - Options object.
     */
    constructor({ driver, options, ...restArgs }: {
        driver: import("../drivers/base.js").default;
        options?: import("../query-parser/options.js").default;
    });
    getConfiguration(): import("../../configuration.js").default;
    getDriver(): import("../drivers/base.js").default;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    getDatabaseType(): string;
    /**
     * Runs to sqls.
     * @abstract
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
}
//# sourceMappingURL=base.d.ts.map