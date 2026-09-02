import OrderBase from "./order-base.js";
export type OrderColumnInput = {
    /**
     * - Column name.
     */
    column: string;
    /**
     * - Sort direction.
     */
    direction?: "ASC" | "DESC" | "asc" | "desc";
    /**
     * - Optional table or alias name.
     */
    tableName?: string;
};
export default class VelociousDatabaseQueryOrderColumn extends OrderBase {
    column: string;
    direction: "ASC" | "DESC";
    reverseOrder: boolean;
    tableName: string | undefined;
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {OrderColumnInput} input - Column order input.
     */
    constructor(query: import("./index.js").default, input: OrderColumnInput);
    /**
     * Runs set reverse order.
     * @param {boolean} [reverseOrder] - Whether to reverse the order.
     * @returns {void}
     */
    setReverseOrder(reverseOrder?: boolean): void;
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql(): string;
}
//# sourceMappingURL=order-column.d.ts.map