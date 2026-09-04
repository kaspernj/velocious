import Logger from "../../logger.js";
import OrderBase from "./order-base.js";
import SelectBase from "./select-base.js";
export type QueryArgsType = {
    /**
     * - Driver instance or factory for query execution.
     */
    driver: import("../drivers/base.js").default | (() => import("../drivers/base.js").default);
    /**
     * - FROM clauses for the query.
     */
    froms?: Array<import("./from-base.js").default>;
    /**
     * - GROUP BY columns.
     */
    groups?: string[];
    /**
     * - JOIN clauses for the query.
     */
    joins?: Array<import("./join-base.js").default>;
    /**
     * - Handler used for executing and transforming results.
     */
    handler: import("../handler.js").default;
    /**
     * - LIMIT clause value.
     */
    limit?: number | null;
    /**
     * - OFFSET clause value.
     */
    offset?: number | null;
    /**
     * - ORDER BY clauses.
     */
    orders?: Array<import("./order-base.js").default>;
    /**
     * - Page number for pagination.
     */
    page?: number | null;
    /**
     * - Records per page for pagination.
     */
    perPage?: number;
    /**
     * - Preload graph for related records.
     */
    preload?: NestedPreloadRecord;
    /**
     * - Attribute names to load for preloaded relationships, keyed by target model name.
     */
    preloadSelects?: Record<string, string[]>;
    /**
     * - Extra selects to load in addition to the defaults for preloaded relationships, keyed by target model name.
     */
    preloadSelectsExtra?: Record<string, string[]>;
    /**
     * - SELECT clauses for the query.
     */
    selects?: Array<import("./select-base.js").default>;
    /**
     * - Signal passed to database query execution.
     */
    signal?: AbortSignal;
    /**
     * - Whether the query should use DISTINCT.
     */
    distinct?: boolean;
    /**
     * - WHERE conditions for the query.
     */
    wheres?: Array<import("./where-base.js").default>;
};
export type NestedPreloadRecord = {
    [key: string]: boolean | string | string[] | NestedPreloadRecord;
};
export type OrderArgumentType = string | number | import("./order-base.js").default | import("./order-column.js").OrderColumnInput;
export type SelectArgumentType = string | string[] | import("./select-base.js").default | import("./select-base.js").default[] | Record<string, string | string[]>;
export type WhereArgumentType = object | string;
export default class VelociousDatabaseQuery {
    /**
     * Narrows the runtime value to the documented type.
     * @type {() => import("../drivers/base.js").default} */
    _driverFn: () => import("../drivers/base.js").default;
    handler: import("../handler.js").default;
    logger: Logger;
    _froms: import("./from-base.js").default[];
    _groups: string[];
    _joins: import("./join-base.js").default[];
    _limit: number | null;
    _offset: number | null;
    _orders: OrderBase[];
    _page: number | null;
    _perPage: number | undefined;
    _preload: NestedPreloadRecord;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    _preloadSelects: Record<string, string[]>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    _preloadSelectsExtra: Record<string, string[]>;
    _distinct: boolean;
    _selects: SelectBase[];
    _signal: AbortSignal | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./where-base.js").default[]} */
    _wheres: import("./where-base.js").default[];
    /**
     * Runs constructor.
     * @param {QueryArgsType} args - Options object.
     */
    constructor({ driver, froms, groups, joins, handler, limit, offset, orders, page, perPage, preload, preloadSelects, preloadSelectsExtra, distinct, selects, signal, wheres }: QueryArgsType);
    /**
     * Runs clone.
     * @returns {this} - The clone.
     */
    clone(): this;
    /**
     * Runs get froms.
     * @returns {import("./from-base.js").default[]} - The froms.
     */
    getFroms(): import("./from-base.js").default[];
    /**
     * Runs get groups.
     * @returns {string[]} - The groups.
     */
    getGroups(): string[];
    /**
     * Runs get joins.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - The joins.
     */
    getJoins(): Array<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get limit.
     * @returns {number | null} - The limit.
     */
    getLimit(): number | null;
    /**
     * Runs get offset.
     * @returns {number | null} - The offset.
     */
    getOffset(): number | null;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs get orders.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - The orders.
     */
    getOrders(): Array<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get selects.
     * @returns {Array<import("./select-base.js").default>} - The selects.
     */
    getSelects(): Array<import("./select-base.js").default>;
    /**
     * Runs get wheres.
     * @returns {Array<import("./where-base.js").default>} - The wheres.
     */
    getWheres(): Array<import("./where-base.js").default>;
    /**
     * Runs from.
     * @param {string|import("./from-base.js").default} from - From.
     * @returns {this} - The from.
     */
    from(from: string | import("./from-base.js").default): this;
    /**
     * Runs group.
     * @param {string} group - Group.
     * @returns {this} - The group.
     */
    group(group: string): this;
    /**
     * Runs joins.
     * @param {string | string[] | import("./join-object.js").JoinObjectInput} join - Join clause or join descriptor.
     * @returns {this} - The joins.
     */
    joins(join: string | string[] | import("./join-object.js").JoinObjectInput): this;
    /**
     * Runs limit.
     * @param {number} value - Value to use.
     * @returns {this} - The limit.
     */
    limit(value: number): this;
    /**
     * Runs offset.
     * @param {number} value - Value to use.
     * @returns {this} - The offset.
     */
    offset(value: number): this;
    /**
     * Runs order.
     * @param {OrderArgumentType} order - Order.
     * @returns {this} - The order.
     */
    order(order: OrderArgumentType): this;
    /**
     * Runs page.
     * @param {number} pageNumber - Page number.
     * @returns {this} - The page.
     */
    page(pageNumber: number): this;
    /**
     * Runs per page.
     * @param {number} perPage - Page size.
     * @returns {this} - The per page.
     */
    perPage(perPage: number): this;
    /**
     * Re-derive LIMIT and OFFSET from whichever of `_page` / `_perPage`
     * are currently set. Called from both `page()` and `perPage()` so the
     * chaining order (`page(n).perPage(pp)` vs `perPage(pp).page(n)`) no
     * longer determines which perPage value wins — the last value of
     * each setter always takes effect.
     * @returns {void}
     */
    _applyPagination(): void;
    /**
     * Runs reorder.
     * @param {OrderArgumentType} order - Order.
     * @returns {this} - The reorder.
     */
    reorder(order: OrderArgumentType): this;
    /**
     * Runs reverse order.
     * @returns {this} - The reverse order.
     */
    reverseOrder(): this;
    /**
     * Runs distinct.
     * @param {boolean} [value] - Value to use.
     * @returns {this} - The distinct.
     */
    distinct(value?: boolean): this;
    /**
     * Replaces the current set of `SELECT` clauses with the given ones.
     * Equivalent to calling `select(...)` after first wiping any previously
     * accumulated selects — mirrors Active Record's `reselect`. Pass no
     * argument (or an empty array) to drop the projection entirely so the
     * driver falls back to its default `SELECT *`.
     * @param {SelectArgumentType} [select] - Select to replace existing selects with.
     * @returns {this} - The query for chaining.
     */
    reselect(select?: SelectArgumentType): this;
    /**
     * Runs select.
     * @param {SelectArgumentType} select - Select.
     * @returns {this} - The select.
     */
    select(select: SelectArgumentType): this;
    /**
     * Runs execute query.
     * @param {object} [args] - Options object.
     * @param {string} [args.logName] - Query log name.
     * @returns {Promise<import("../drivers/base.js").QueryResultType>} Array of results from the database
     */
    _executeQuery({ logName }?: {
        logName?: string;
    }): Promise<import("../drivers/base.js").QueryResultType>;
    /**
     * Sets the signal used to cancel database execution for this query and its clones.
     * @param {AbortSignal | undefined} signal - Cancellation signal, or undefined to clear it.
     * @returns {this} - Query for chaining.
     */
    signal(signal: AbortSignal | undefined): this;
    /**
     * Runs results.
     * @returns {Promise<import("../drivers/base.js").QueryResultType>} Array of results from the database
     */
    results(): Promise<import("../drivers/base.js").QueryResultType>;
    /**
     * Runs query log name.
     * @param {string} operation - Query operation.
     * @returns {string} - Query log name.
     */
    queryLogName(operation: string): string;
    /**
     * Generates SQL string representing this query
     * @returns {string} SQL string representing this query
     */
    toSql(): string;
    /**
     * Runs where.
     * @param {WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    where(where: WhereArgumentType): this;
    /**
     * Runs where not.
     * @param {WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    whereNot(where: WhereArgumentType): this;
    /**
     * Resolves the current driver lazily.
     * @returns {import("../drivers/base.js").default} - A value.
     */
    get driver(): import("../drivers/base.js").default;
}
//# sourceMappingURL=index.d.ts.map