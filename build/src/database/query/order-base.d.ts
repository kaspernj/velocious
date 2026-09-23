export default class VelociousDatabaseQueryOrderBase {
    query: import("./index.js").default;
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     */
    constructor(query: import("./index.js").default);
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs set reverse order.
     * @abstract
     * @param {boolean} _reverseOrder - Whether reverse order.
     * @returns {void} - No return value.
     */
    setReverseOrder(_reverseOrder: boolean): void;
    /**
     * Runs reversed copy.
     * @abstract
     * @returns {import("./order-base.js").default} - A new independent order with the direction reversed.
     */
    reversedCopy(): import("./order-base.js").default;
    toSql(): void;
}
//# sourceMappingURL=order-base.d.ts.map