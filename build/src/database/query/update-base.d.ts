export default class VelociousDatabaseQueryUpdateBase {
    conditions: Record<string, any>;
    data: Record<string, any>;
    driver: import("../drivers/base.js").default;
    tableName: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.conditions - Conditions.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.data - Data payload.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {string} args.tableName - Table name.
     */
    constructor({ conditions, data, driver, tableName }: {
        conditions: Record<string, ReturnType<typeof JSON.parse>>;
        data: Record<string, ReturnType<typeof JSON.parse>>;
        driver: import("../drivers/base.js").default;
        tableName: string;
    });
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs format value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to format.
     * @returns {string | number} - SQL literal.
     */
    formatValue(value: ReturnType<typeof JSON.parse>): string | number;
    toSql(): void;
}
//# sourceMappingURL=update-base.d.ts.map