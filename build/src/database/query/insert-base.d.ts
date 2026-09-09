export default class VelociousDatabaseQueryInsertBase {
    columns: string[] | undefined;
    data: Record<string, any> | undefined;
    driver: import("../drivers/base.js").default;
    multiple: boolean | undefined;
    returnLastInsertedColumnNames: string[] | undefined;
    rows: any[][] | undefined;
    tableName: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.data] - Data payload.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {string} args.tableName - Table name.
     * @param {Array<string>} [args.columns] - Column names.
     * @param {boolean} [args.multiple] - Whether multiple.
     * @param {string[]} [args.returnLastInsertedColumnNames] - Return last inserted column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} [args.rows] - Rows to insert.
     */
    constructor({ columns, data, driver, multiple, tableName, returnLastInsertedColumnNames, rows, ...restArgs }: {
        data?: Record<string, ReturnType<typeof JSON.parse>>;
        driver: import("../drivers/base.js").default;
        tableName: string;
        columns?: Array<string>;
        multiple?: boolean;
        returnLastInsertedColumnNames?: string[];
        rows?: Array<Array<ReturnType<typeof JSON.parse>>>;
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
    /**
     * Runs to sql.
     * @returns {string} SQL statement
     */
    toSql(): string;
    /**
     * Runs values sql.
     * @param {Array<ReturnType<typeof JSON.parse>>} data - Data payload.
     * @returns {string} - SQL string.
     */
    _valuesSql(data: Array<ReturnType<typeof JSON.parse>>): string;
}
//# sourceMappingURL=insert-base.d.ts.map