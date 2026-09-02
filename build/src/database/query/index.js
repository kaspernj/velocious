// @ts-check
import FromPlain from "./from-plain.js";
import { isPlainObject } from "is-plain-object";
import JoinObject from "./join-object.js";
import JoinPlain from "./join-plain.js";
import Logger from "../../logger.js";
import OrderBase from "./order-base.js";
import OrderColumn from "./order-column.js";
import OrderPlain from "./order-plain.js";
import SelectBase from "./select-base.js";
import SelectPlain from "./select-plain.js";
import WhereHash from "./where-hash.js";
import WhereNot from "./where-not.js";
import WherePlain from "./where-plain.js";
/**
 * QueryArgsType type.
 * @typedef {object} QueryArgsType
 * @property {import("../drivers/base.js").default | (() => import("../drivers/base.js").default)} driver - Driver instance or factory for query execution.
 * @property {Array<import("./from-base.js").default>} [froms] - FROM clauses for the query.
 * @property {string[]} [groups] - GROUP BY columns.
 * @property {Array<import("./join-base.js").default>} [joins] - JOIN clauses for the query.
 * @property {import("../handler.js").default} handler - Handler used for executing and transforming results.
 * @property {number | null} [limit] - LIMIT clause value.
 * @property {number | null} [offset] - OFFSET clause value.
 * @property {Array<import("./order-base.js").default>} [orders] - ORDER BY clauses.
 * @property {number | null} [page] - Page number for pagination.
 * @property {number} [perPage] - Records per page for pagination.
 * @property {NestedPreloadRecord} [preload] - Preload graph for related records.
 * @property {Record<string, string[]>} [preloadSelects] - Attribute names to load for preloaded relationships, keyed by target model name.
 * @property {Record<string, string[]>} [preloadSelectsExtra] - Extra selects to load in addition to the defaults for preloaded relationships, keyed by target model name.
 * @property {Array<import("./select-base.js").default>} [selects] - SELECT clauses for the query.
 * @property {AbortSignal} [signal] - Signal passed to database query execution.
 * @property {boolean} [distinct] - Whether the query should use DISTINCT.
 * @property {Array<import("./where-base.js").default>} [wheres] - WHERE conditions for the query.
 */
/**
 * OrderArgumentType type.
 * @typedef {{[key: string]: boolean | string | string[] | NestedPreloadRecord }} NestedPreloadRecord
 * @typedef {string | number | import("./order-base.js").default | import("./order-column.js").OrderColumnInput} OrderArgumentType
 * @typedef {string | string[] | import("./select-base.js").default | import("./select-base.js").default[] | Record<string, string | string[]>} SelectArgumentType
 * @typedef {object | string} WhereArgumentType
 */
/**
 * Runs normalize join object.
 * @param {import("./join-object.js").JoinObjectInput | string | string[]} join - Join data in shorthand or nested form.
 * @returns {import("./join-object.js").JoinObject} - Normalized join record.
 */
function normalizeJoinObject(join) {
    if (!join)
        return {};
    if (typeof join == "string") {
        return { [join]: true };
    }
    if (Array.isArray(join)) {
        /**
         * Result.
         * @type {import("./join-object.js").JoinObject} */
        const result = {};
        for (const entry of join) {
            if (typeof entry == "string") {
                const existing = result[entry];
                result[entry] = mergeJoinValue(existing, true);
                continue;
            }
            if (isPlainObject(entry)) {
                const normalized = normalizeJoinObject(entry);
                for (const [key, value] of Object.entries(normalized)) {
                    const existing = result[key];
                    result[key] = mergeJoinValue(existing, value);
                }
                continue;
            }
            throw new Error(`Invalid join entry type: ${typeof entry}`);
        }
        return result;
    }
    if (!isPlainObject(join)) {
        throw new Error(`Invalid join type: ${typeof join}`);
    }
    /**
     * Result.
     * @type {import("./join-object.js").JoinObject} */
    const result = {};
    for (const [key, value] of Object.entries(join)) {
        if (value === true || value === false) {
            const existing = result[key];
            result[key] = mergeJoinValue(existing, value);
            continue;
        }
        if (typeof value == "string" || Array.isArray(value) || isPlainObject(value)) {
            const existing = result[key];
            result[key] = mergeJoinValue(existing, normalizeJoinObject(value));
            continue;
        }
        throw new Error(`Invalid join value for ${key}: ${typeof value}`);
    }
    return result;
}
/**
 * Runs merge join value.
 * @param {import("./join-object.js").JoinObject[string] | undefined} existing - Existing normalized join value.
 * @param {import("./join-object.js").JoinObject[string]} incoming - Incoming normalized join value.
 * @returns {import("./join-object.js").JoinObject[string]} - Merged join value.
 */
function mergeJoinValue(existing, incoming) {
    if (!existing)
        return incoming;
    if (existing === true || incoming === true)
        return true;
    if (typeof existing == "object" && typeof incoming == "object") {
        return { ...existing, ...incoming };
    }
    return incoming;
}
export default class VelociousDatabaseQuery {
    /**
     * Runs constructor.
     * @param {QueryArgsType} args - Options object.
     */
    constructor({ driver, froms = [], groups = [], joins = [], handler, limit = null, offset = null, orders = [], page = null, perPage, preload = {}, preloadSelects = {}, preloadSelectsExtra = {}, distinct = false, selects = [], signal, wheres = [] }) {
        if (!driver)
            throw new Error("No driver given to query");
        if (!handler)
            throw new Error("No handler given to query");
        /**
         * Narrows the runtime value to the documented type.
         * @type {() => import("../drivers/base.js").default} */
        this._driverFn = typeof driver === "function" ? driver : () => driver;
        this.handler = handler;
        this.logger = new Logger(this);
        this._froms = froms;
        this._groups = groups;
        this._joins = joins;
        this._limit = limit;
        this._offset = offset;
        this._orders = orders;
        this._page = page;
        this._perPage = perPage;
        this._preload = preload;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, string[]>} */
        this._preloadSelects = preloadSelects;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, string[]>} */
        this._preloadSelectsExtra = preloadSelectsExtra;
        this._distinct = distinct;
        this._selects = selects;
        this._signal = signal;
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("./where-base.js").default[]} */
        this._wheres = wheres;
        const boundWhere = /** @type {ReturnType<typeof JSON.parse>} */ (this.where.bind(this));
        boundWhere.not = this.whereNot.bind(this);
        this.where = boundWhere;
    }
    /**
     * Runs clone.
     * @returns {this} - The clone.
     */
    clone() {
        const QueryClass = /** @type {new (args: QueryArgsType) => this} */ (this.constructor);
        const newQuery = new QueryClass({
            driver: this._driverFn,
            froms: [...this._froms],
            handler: this.handler.clone(),
            groups: [...this._groups],
            joins: [...this._joins],
            limit: this._limit,
            offset: this._offset,
            orders: [...this._orders],
            page: this._page,
            perPage: this._perPage,
            preload: { ...this._preload },
            distinct: this._distinct,
            selects: [...this._selects],
            signal: this._signal,
            wheres: [...this._wheres]
        });
        return newQuery;
    }
    /**
     * Runs get froms.
     * @returns {import("./from-base.js").default[]} - The froms.
     */
    getFroms() {
        return this._froms;
    }
    /**
     * Runs get groups.
     * @returns {string[]} - The groups.
     */
    getGroups() {
        return this._groups;
    }
    /**
     * Runs get joins.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - The joins.
     */
    getJoins() { return this._joins; }
    /**
     * Runs get limit.
     * @returns {number | null} - The limit.
     */
    getLimit() { return this._limit; }
    /**
     * Runs get offset.
     * @returns {number | null} - The offset.
     */
    getOffset() { return this._offset; }
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions() { return this.driver.options(); }
    /**
     * Runs get orders.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - The orders.
     */
    getOrders() { return this._orders; }
    /**
     * Runs get selects.
     * @returns {Array<import("./select-base.js").default>} - The selects.
     */
    getSelects() { return this._selects; }
    /**
     * Runs get wheres.
     * @returns {Array<import("./where-base.js").default>} - The wheres.
     */
    getWheres() { return this._wheres; }
    /**
     * Runs from.
     * @param {string|import("./from-base.js").default} from - From.
     * @returns {this} - The from.
     */
    from(from) {
        if (typeof from == "string")
            from = new FromPlain(from);
        this._froms.push(from);
        return this;
    }
    /**
     * Runs group.
     * @param {string} group - Group.
     * @returns {this} - The group.
     */
    group(group) {
        this._groups.push(group);
        return this;
    }
    /**
     * Runs joins.
     * @param {string | string[] | import("./join-object.js").JoinObjectInput} join - Join clause or join descriptor.
     * @returns {this} - The joins.
     */
    joins(join) {
        if (typeof join == "string") {
            this._joins.push(new JoinPlain(join));
        }
        else if (Array.isArray(join)) {
            this._joins.push(new JoinObject(normalizeJoinObject(join)));
        }
        else if (isPlainObject(join)) {
            this._joins.push(new JoinObject(normalizeJoinObject(join)));
        }
        else {
            throw new Error(`Unknown type of join: ${typeof join}`);
        }
        return this;
    }
    /**
     * Runs limit.
     * @param {number} value - Value to use.
     * @returns {this} - The limit.
     */
    limit(value) {
        this._limit = value;
        return this;
    }
    /**
     * Runs offset.
     * @param {number} value - Value to use.
     * @returns {this} - The offset.
     */
    offset(value) {
        this._offset = value;
        return this;
    }
    /**
     * Runs order.
     * @param {OrderArgumentType} order - Order.
     * @returns {this} - The order.
     */
    order(order) {
        if (typeof order == "string") {
            this._orders.push(new OrderPlain(this, order));
        }
        else if (typeof order == "number") {
            this._orders.push(new OrderPlain(this, `${order}`));
        }
        else if (order instanceof OrderBase) {
            this._orders.push(order);
        }
        else if (isPlainObject(order)) {
            this._orders.push(new OrderColumn(this, order));
        }
        else {
            throw new Error(`Unknown order type: ${typeof order}`);
        }
        return this;
    }
    /**
     * Runs page.
     * @param {number} pageNumber - Page number.
     * @returns {this} - The page.
     */
    page(pageNumber) {
        this._page = pageNumber;
        this._applyPagination();
        return this;
    }
    /**
     * Runs per page.
     * @param {number} perPage - Page size.
     * @returns {this} - The per page.
     */
    perPage(perPage) {
        this._perPage = perPage;
        this._applyPagination();
        return this;
    }
    /**
     * Re-derive LIMIT and OFFSET from whichever of `_page` / `_perPage`
     * are currently set. Called from both `page()` and `perPage()` so the
     * chaining order (`page(n).perPage(pp)` vs `perPage(pp).page(n)`) no
     * longer determines which perPage value wins — the last value of
     * each setter always takes effect.
     * @returns {void}
     */
    _applyPagination() {
        if (this._page == null)
            return;
        const perPage = this._perPage || 30;
        const offset = (this._page - 1) * perPage;
        this.limit(perPage);
        this.offset(offset);
    }
    /**
     * Runs reorder.
     * @param {OrderArgumentType} order - Order.
     * @returns {this} - The reorder.
     */
    reorder(order) {
        this._orders = [];
        this.order(order);
        return this;
    }
    /**
     * Runs reverse order.
     * @returns {this} - The reverse order.
     */
    reverseOrder() {
        for (const order of this._orders) {
            order.setReverseOrder(true);
        }
        return this;
    }
    /**
     * Runs distinct.
     * @param {boolean} [value] - Value to use.
     * @returns {this} - The distinct.
     */
    distinct(value = true) {
        this._distinct = value;
        return this;
    }
    /**
     * Replaces the current set of `SELECT` clauses with the given ones.
     * Equivalent to calling `select(...)` after first wiping any previously
     * accumulated selects — mirrors Active Record's `reselect`. Pass no
     * argument (or an empty array) to drop the projection entirely so the
     * driver falls back to its default `SELECT *`.
     * @param {SelectArgumentType} [select] - Select to replace existing selects with.
     * @returns {this} - The query for chaining.
     */
    reselect(select) {
        this._selects = [];
        if (typeof select == "undefined")
            return this;
        return this.select(select);
    }
    /**
     * Runs select.
     * @param {SelectArgumentType} select - Select.
     * @returns {this} - The select.
     */
    select(select) {
        if (Array.isArray(select)) {
            for (const selectInArray of select) {
                this.select(selectInArray);
            }
            return this;
        }
        if (typeof select == "string") {
            this._selects.push(new SelectPlain(select));
        }
        else if (select instanceof SelectBase) {
            this._selects.push(select);
        }
        else {
            throw new Error(`Invalid select type: ${typeof select}`);
        }
        return this;
    }
    /**
     * Runs execute query.
     * @param {object} [args] - Options object.
     * @param {string} [args.logName] - Query log name.
     * @returns {Promise<Array<object>>} Array of results from the database
     */
    async _executeQuery({ logName = this.queryLogName("Load") } = {}) {
        const sql = this.toSql();
        const results = await this.driver.query(sql, { logName, signal: this._signal });
        return results;
    }
    /**
     * Sets the signal used to cancel database execution for this query and its clones.
     * @param {AbortSignal | undefined} signal - Cancellation signal, or undefined to clear it.
     * @returns {this} - Query for chaining.
     */
    signal(signal) {
        this._signal = signal;
        return this;
    }
    /**
     * Runs results.
     * @returns {Promise<Array<object>>} Array of results from the database
     */
    async results() {
        return await this._executeQuery();
    }
    /**
     * Runs query log name.
     * @param {string} operation - Query operation.
     * @returns {string} - Query log name.
     */
    queryLogName(operation) {
        void operation;
        return "SQL";
    }
    /**
     * Generates SQL string representing this query
     * @returns {string} SQL string representing this query
     */
    toSql() { return this.driver.queryToSql(this); }
    /**
     * Runs where.
     * @param {WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    where(where) {
        if (typeof where == "string") {
            this._wheres.push(new WherePlain(this, where));
        }
        else if (typeof where == "object" && (where.constructor.name == "object" || where.constructor.name == "Object")) {
            this._wheres.push(new WhereHash(this, /** @type {import("./where-hash.js").WhereHash} */ (where)));
        }
        else {
            throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`);
        }
        return this;
    }
    /**
     * Runs where not.
     * @param {WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    whereNot(where) {
        if (typeof where == "string") {
            this._wheres.push(new WhereNot(new WherePlain(this, where)));
        }
        else if (typeof where == "object" && (where.constructor.name == "object" || where.constructor.name == "Object")) {
            this._wheres.push(new WhereNot(new WhereHash(this, /** @type {import("./where-hash.js").WhereHash} */ (where))));
        }
        else {
            throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`);
        }
        return this;
    }
    /**
     * Resolves the current driver lazily.
     * @returns {import("../drivers/base.js").default} - A value.
     */
    get driver() {
        return this._driverFn();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUM3QyxPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUN2QyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUN2QyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUN6QyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFNBQVMsTUFBTSxpQkFBaUIsQ0FBQTtBQUN2QyxPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNyQyxPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUV6Qzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSDs7Ozs7O0dBTUc7QUFFSDs7OztHQUlHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxJQUFJO0lBQy9CLElBQUksQ0FBQyxJQUFJO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFcEIsSUFBSSxPQUFPLElBQUksSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUM1QixPQUFPLEVBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUN2QixDQUFDO0lBRUQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDeEI7OzJEQUVtRDtRQUNuRCxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7UUFF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QU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsMEJBQTBCLE9BQU8sS0FBSyxLQUFLLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQTtRQUN2RixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFFBQVEsQ0FBQyxLQUFLO1FBQ1osSUFBSSxPQUFPLEtBQUssSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUM3QixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFFBQVEsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQzlELENBQUM7YUFBTSxJQUFJLE9BQU8sS0FBSyxJQUFJLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxJQUFJLFFBQVEsSUFBSSxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQ2xILElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksUUFBUSxDQUFDLElBQUksU0FBUyxDQUFDLElBQUksRUFBRSxrREFBa0QsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ2xILENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsT0FBTyxLQUFLLEtBQUssS0FBSyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZGLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7O09BR0c7SUFDSCxJQUFJLE1BQU07UUFDUixPQUFPLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtJQUN6QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEZyb21QbGFpbiBmcm9tIFwiLi9mcm9tLXBsYWluLmpzXCJcbmltcG9ydCB7aXNQbGFpbk9iamVjdH0gZnJvbSBcImlzLXBsYWluLW9iamVjdFwiXG5pbXBvcnQgSm9pbk9iamVjdCBmcm9tIFwiLi9qb2luLW9iamVjdC5qc1wiXG5pbXBvcnQgSm9pblBsYWluIGZyb20gXCIuL2pvaW4tcGxhaW4uanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBPcmRlckJhc2UgZnJvbSBcIi4vb3JkZXItYmFzZS5qc1wiXG5pbXBvcnQgT3JkZXJDb2x1bW4gZnJvbSBcIi4vb3JkZXItY29sdW1uLmpzXCJcbmltcG9ydCBPcmRlclBsYWluIGZyb20gXCIuL29yZGVyLXBsYWluLmpzXCJcbmltcG9ydCBTZWxlY3RCYXNlIGZyb20gXCIuL3NlbGVjdC1iYXNlLmpzXCJcbmltcG9ydCBTZWxlY3RQbGFpbiBmcm9tIFwiLi9zZWxlY3QtcGxhaW4uanNcIlxuaW1wb3J0IFdoZXJlSGFzaCBmcm9tIFwiLi93aGVyZS1oYXNoLmpzXCJcbmltcG9ydCBXaGVyZU5vdCBmcm9tIFwiLi93aGVyZS1ub3QuanNcIlxuaW1wb3J0IFdoZXJlUGxhaW4gZnJvbSBcIi4vd2hlcmUtcGxhaW4uanNcIlxuXG4vKipcbiAqIFF1ZXJ5QXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFF1ZXJ5QXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCAoKCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpfSBkcml2ZXIgLSBEcml2ZXIgaW5zdGFuY2Ugb3IgZmFjdG9yeSBmb3IgcXVlcnkgZXhlY3V0aW9uLlxuICogQHByb3BlcnR5IHtBcnJheTxpbXBvcnQoXCIuL2Zyb20tYmFzZS5qc1wiKS5kZWZhdWx0Pn0gW2Zyb21zXSAtIEZST00gY2xhdXNlcyBmb3IgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW2dyb3Vwc10gLSBHUk9VUCBCWSBjb2x1bW5zLlxuICogQHByb3BlcnR5IHtBcnJheTxpbXBvcnQoXCIuL2pvaW4tYmFzZS5qc1wiKS5kZWZhdWx0Pn0gW2pvaW5zXSAtIEpPSU4gY2xhdXNlcyBmb3IgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9oYW5kbGVyLmpzXCIpLmRlZmF1bHR9IGhhbmRsZXIgLSBIYW5kbGVyIHVzZWQgZm9yIGV4ZWN1dGluZyBhbmQgdHJhbnNmb3JtaW5nIHJlc3VsdHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IFtsaW1pdF0gLSBMSU1JVCBjbGF1c2UgdmFsdWUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IFtvZmZzZXRdIC0gT0ZGU0VUIGNsYXVzZSB2YWx1ZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8aW1wb3J0KFwiLi9vcmRlci1iYXNlLmpzXCIpLmRlZmF1bHQ+fSBbb3JkZXJzXSAtIE9SREVSIEJZIGNsYXVzZXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IFtwYWdlXSAtIFBhZ2UgbnVtYmVyIGZvciBwYWdpbmF0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtwZXJQYWdlXSAtIFJlY29yZHMgcGVyIHBhZ2UgZm9yIHBhZ2luYXRpb24uXG4gKiBAcHJvcGVydHkge05lc3RlZFByZWxvYWRSZWNvcmR9IFtwcmVsb2FkXSAtIFByZWxvYWQgZ3JhcGggZm9yIHJlbGF0ZWQgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbcHJlbG9hZFNlbGVjdHNdIC0gQXR0cmlidXRlIG5hbWVzIHRvIGxvYWQgZm9yIHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLCBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbcHJlbG9hZFNlbGVjdHNFeHRyYV0gLSBFeHRyYSBzZWxlY3RzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzIGZvciBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcywga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PGltcG9ydChcIi4vc2VsZWN0LWJhc2UuanNcIikuZGVmYXVsdD59IFtzZWxlY3RzXSAtIFNFTEVDVCBjbGF1c2VzIGZvciB0aGUgcXVlcnkuXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsfSBbc2lnbmFsXSAtIFNpZ25hbCBwYXNzZWQgdG8gZGF0YWJhc2UgcXVlcnkgZXhlY3V0aW9uLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGlzdGluY3RdIC0gV2hldGhlciB0aGUgcXVlcnkgc2hvdWxkIHVzZSBESVNUSU5DVC5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHQ+fSBbd2hlcmVzXSAtIFdIRVJFIGNvbmRpdGlvbnMgZm9yIHRoZSBxdWVyeS5cbiAqL1xuLyoqXG4gKiBPcmRlckFyZ3VtZW50VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge3tba2V5OiBzdHJpbmddOiBib29sZWFuIHwgc3RyaW5nIHwgc3RyaW5nW10gfCBOZXN0ZWRQcmVsb2FkUmVjb3JkIH19IE5lc3RlZFByZWxvYWRSZWNvcmRcbiAqIEB0eXBlZGVmIHtzdHJpbmcgfCBudW1iZXIgfCBpbXBvcnQoXCIuL29yZGVyLWJhc2UuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vb3JkZXItY29sdW1uLmpzXCIpLk9yZGVyQ29sdW1uSW5wdXR9IE9yZGVyQXJndW1lbnRUeXBlXG4gKiBAdHlwZWRlZiB7c3RyaW5nIHwgc3RyaW5nW10gfCBpbXBvcnQoXCIuL3NlbGVjdC1iYXNlLmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL3NlbGVjdC1iYXNlLmpzXCIpLmRlZmF1bHRbXSB8IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gU2VsZWN0QXJndW1lbnRUeXBlXG4gKiBAdHlwZWRlZiB7b2JqZWN0IHwgc3RyaW5nfSBXaGVyZUFyZ3VtZW50VHlwZVxuICovXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgam9pbiBvYmplY3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vam9pbi1vYmplY3QuanNcIikuSm9pbk9iamVjdElucHV0IHwgc3RyaW5nIHwgc3RyaW5nW119IGpvaW4gLSBKb2luIGRhdGEgaW4gc2hvcnRoYW5kIG9yIG5lc3RlZCBmb3JtLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vam9pbi1vYmplY3QuanNcIikuSm9pbk9iamVjdH0gLSBOb3JtYWxpemVkIGpvaW4gcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVKb2luT2JqZWN0KGpvaW4pIHtcbiAgaWYgKCFqb2luKSByZXR1cm4ge31cblxuICBpZiAodHlwZW9mIGpvaW4gPT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB7W2pvaW5dOiB0cnVlfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoam9pbikpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vam9pbi1vYmplY3QuanNcIikuSm9pbk9iamVjdH0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBqb2luKSB7XG4gICAgICBpZiAodHlwZW9mIGVudHJ5ID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSByZXN1bHRbZW50cnldXG4gICAgICAgIHJlc3VsdFtlbnRyeV0gPSBtZXJnZUpvaW5WYWx1ZShleGlzdGluZywgdHJ1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QoZW50cnkpKSB7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVKb2luT2JqZWN0KGVudHJ5KVxuXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG5vcm1hbGl6ZWQpKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSByZXN1bHRba2V5XVxuICAgICAgICAgIHJlc3VsdFtrZXldID0gbWVyZ2VKb2luVmFsdWUoZXhpc3RpbmcsIHZhbHVlKVxuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBqb2luIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGVudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KGpvaW4pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGpvaW4gdHlwZTogJHt0eXBlb2Ygam9pbn1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3VsdC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vam9pbi1vYmplY3QuanNcIikuSm9pbk9iamVjdH0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge31cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhqb2luKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSB8fCB2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gcmVzdWx0W2tleV1cbiAgICAgIHJlc3VsdFtrZXldID0gbWVyZ2VKb2luVmFsdWUoZXhpc3RpbmcsIHZhbHVlKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkgfHwgaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gcmVzdWx0W2tleV1cbiAgICAgIHJlc3VsdFtrZXldID0gbWVyZ2VKb2luVmFsdWUoZXhpc3RpbmcsIG5vcm1hbGl6ZUpvaW5PYmplY3QodmFsdWUpKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgam9pbiB2YWx1ZSBmb3IgJHtrZXl9OiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2Ugam9pbiB2YWx1ZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9qb2luLW9iamVjdC5qc1wiKS5Kb2luT2JqZWN0W3N0cmluZ10gfCB1bmRlZmluZWR9IGV4aXN0aW5nIC0gRXhpc3Rpbmcgbm9ybWFsaXplZCBqb2luIHZhbHVlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2pvaW4tb2JqZWN0LmpzXCIpLkpvaW5PYmplY3Rbc3RyaW5nXX0gaW5jb21pbmcgLSBJbmNvbWluZyBub3JtYWxpemVkIGpvaW4gdmFsdWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9qb2luLW9iamVjdC5qc1wiKS5Kb2luT2JqZWN0W3N0cmluZ119IC0gTWVyZ2VkIGpvaW4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG1lcmdlSm9pblZhbHVlKGV4aXN0aW5nLCBpbmNvbWluZykge1xuICBpZiAoIWV4aXN0aW5nKSByZXR1cm4gaW5jb21pbmdcbiAgaWYgKGV4aXN0aW5nID09PSB0cnVlIHx8IGluY29taW5nID09PSB0cnVlKSByZXR1cm4gdHJ1ZVxuXG4gIGlmICh0eXBlb2YgZXhpc3RpbmcgPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgaW5jb21pbmcgPT0gXCJvYmplY3RcIikge1xuICAgIHJldHVybiB7Li4uZXhpc3RpbmcsIC4uLmluY29taW5nfVxuICB9XG5cbiAgcmV0dXJuIGluY29taW5nXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnkge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtRdWVyeUFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7XG4gICAgZHJpdmVyLFxuICAgIGZyb21zID0gW10sXG4gICAgZ3JvdXBzID0gW10sXG4gICAgam9pbnMgPSBbXSxcbiAgICBoYW5kbGVyLFxuICAgIGxpbWl0ID0gbnVsbCxcbiAgICBvZmZzZXQgPSBudWxsLFxuICAgIG9yZGVycyA9IFtdLFxuICAgIHBhZ2UgPSBudWxsLFxuICAgIHBlclBhZ2UsXG4gICAgcHJlbG9hZCA9IHt9LFxuICAgIHByZWxvYWRTZWxlY3RzID0ge30sXG4gICAgcHJlbG9hZFNlbGVjdHNFeHRyYSA9IHt9LFxuICAgIGRpc3RpbmN0ID0gZmFsc2UsXG4gICAgc2VsZWN0cyA9IFtdLFxuICAgIHNpZ25hbCxcbiAgICB3aGVyZXMgPSBbXVxuICB9KSB7XG4gICAgaWYgKCFkcml2ZXIpIHRocm93IG5ldyBFcnJvcihcIk5vIGRyaXZlciBnaXZlbiB0byBxdWVyeVwiKVxuICAgIGlmICghaGFuZGxlcikgdGhyb3cgbmV3IEVycm9yKFwiTm8gaGFuZGxlciBnaXZlbiB0byBxdWVyeVwiKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHsoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gKi9cbiAgICB0aGlzLl9kcml2ZXJGbiA9IHR5cGVvZiBkcml2ZXIgPT09IFwiZnVuY3Rpb25cIiA/IGRyaXZlciA6ICgpID0+IGRyaXZlclxuICAgIHRoaXMuaGFuZGxlciA9IGhhbmRsZXJcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLl9mcm9tcyA9IGZyb21zXG4gICAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzXG4gICAgdGhpcy5fam9pbnMgPSBqb2luc1xuICAgIHRoaXMuX2xpbWl0ID0gbGltaXRcbiAgICB0aGlzLl9vZmZzZXQgPSBvZmZzZXRcbiAgICB0aGlzLl9vcmRlcnMgPSBvcmRlcnNcbiAgICB0aGlzLl9wYWdlID0gcGFnZVxuICAgIHRoaXMuX3BlclBhZ2UgPSBwZXJQYWdlXG4gICAgdGhpcy5fcHJlbG9hZCA9IHByZWxvYWRcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICAgIHRoaXMuX3ByZWxvYWRTZWxlY3RzID0gcHJlbG9hZFNlbGVjdHNcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICAgIHRoaXMuX3ByZWxvYWRTZWxlY3RzRXh0cmEgPSBwcmVsb2FkU2VsZWN0c0V4dHJhXG4gICAgdGhpcy5fZGlzdGluY3QgPSBkaXN0aW5jdFxuICAgIHRoaXMuX3NlbGVjdHMgPSBzZWxlY3RzXG4gICAgdGhpcy5fc2lnbmFsID0gc2lnbmFsXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgdGhpcy5fd2hlcmVzID0gd2hlcmVzXG5cbiAgICBjb25zdCBib3VuZFdoZXJlID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMud2hlcmUuYmluZCh0aGlzKSlcbiAgICBib3VuZFdoZXJlLm5vdCA9IHRoaXMud2hlcmVOb3QuYmluZCh0aGlzKVxuICAgIHRoaXMud2hlcmUgPSBib3VuZFdoZXJlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9uZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIGNsb25lLlxuICAgKi9cbiAgY2xvbmUoKSB7XG4gICAgY29uc3QgUXVlcnlDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhcmdzOiBRdWVyeUFyZ3NUeXBlKSA9PiB0aGlzfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBuZXdRdWVyeSA9IG5ldyBRdWVyeUNsYXNzKHtcbiAgICAgIGRyaXZlcjogdGhpcy5fZHJpdmVyRm4sXG4gICAgICBmcm9tczogWy4uLnRoaXMuX2Zyb21zXSxcbiAgICAgIGhhbmRsZXI6IHRoaXMuaGFuZGxlci5jbG9uZSgpLFxuICAgICAgZ3JvdXBzOiBbLi4udGhpcy5fZ3JvdXBzXSxcbiAgICAgIGpvaW5zOiBbLi4udGhpcy5fam9pbnNdLFxuICAgICAgbGltaXQ6IHRoaXMuX2xpbWl0LFxuICAgICAgb2Zmc2V0OiB0aGlzLl9vZmZzZXQsXG4gICAgICBvcmRlcnM6IFsuLi50aGlzLl9vcmRlcnNdLFxuICAgICAgcGFnZTogdGhpcy5fcGFnZSxcbiAgICAgIHBlclBhZ2U6IHRoaXMuX3BlclBhZ2UsXG4gICAgICBwcmVsb2FkOiB7Li4udGhpcy5fcHJlbG9hZH0sXG4gICAgICBkaXN0aW5jdDogdGhpcy5fZGlzdGluY3QsXG4gICAgICBzZWxlY3RzOiBbLi4udGhpcy5fc2VsZWN0c10sXG4gICAgICBzaWduYWw6IHRoaXMuX3NpZ25hbCxcbiAgICAgIHdoZXJlczogWy4uLnRoaXMuX3doZXJlc11cbiAgICB9KVxuXG4gICAgcmV0dXJuIG5ld1F1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZnJvbXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Zyb20tYmFzZS5qc1wiKS5kZWZhdWx0W119IC0gVGhlIGZyb21zLlxuICAgKi9cbiAgZ2V0RnJvbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Zyb21zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZ3JvdXBzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIGdyb3Vwcy5cbiAgICovXG4gIGdldEdyb3VwcygpIHtcbiAgICByZXR1cm4gdGhpcy5fZ3JvdXBzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9pbnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGpvaW5zLlxuICAgKi9cbiAgZ2V0Sm9pbnMoKSB7IHJldHVybiB0aGlzLl9qb2lucyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpbWl0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaGUgbGltaXQuXG4gICAqL1xuICBnZXRMaW1pdCgpIHsgcmV0dXJuIHRoaXMuX2xpbWl0IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb2Zmc2V0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaGUgb2Zmc2V0LlxuICAgKi9cbiAgZ2V0T2Zmc2V0KCkgeyByZXR1cm4gdGhpcy5fb2Zmc2V0IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIGdldE9wdGlvbnMoKSB7IHJldHVybiB0aGlzLmRyaXZlci5vcHRpb25zKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBvcmRlcnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIG9yZGVycy5cbiAgICovXG4gIGdldE9yZGVycygpIHsgcmV0dXJuIHRoaXMuX29yZGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHNlbGVjdHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxpbXBvcnQoXCIuL3NlbGVjdC1iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSBzZWxlY3RzLlxuICAgKi9cbiAgZ2V0U2VsZWN0cygpIHsgcmV0dXJuIHRoaXMuX3NlbGVjdHMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB3aGVyZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxpbXBvcnQoXCIuL3doZXJlLWJhc2UuanNcIikuZGVmYXVsdD59IC0gVGhlIHdoZXJlcy5cbiAgICovXG4gIGdldFdoZXJlcygpIHsgcmV0dXJuIHRoaXMuX3doZXJlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbS5cbiAgICogQHBhcmFtIHtzdHJpbmd8aW1wb3J0KFwiLi9mcm9tLWJhc2UuanNcIikuZGVmYXVsdH0gZnJvbSAtIEZyb20uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBmcm9tLlxuICAgKi9cbiAgZnJvbShmcm9tKSB7XG4gICAgaWYgKHR5cGVvZiBmcm9tID09IFwic3RyaW5nXCIpIGZyb20gPSBuZXcgRnJvbVBsYWluKGZyb20pXG5cbiAgICB0aGlzLl9mcm9tcy5wdXNoKGZyb20pXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZ3JvdXAgLSBHcm91cC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIGdyb3VwLlxuICAgKi9cbiAgZ3JvdXAoZ3JvdXApIHtcbiAgICB0aGlzLl9ncm91cHMucHVzaChncm91cClcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBpbXBvcnQoXCIuL2pvaW4tb2JqZWN0LmpzXCIpLkpvaW5PYmplY3RJbnB1dH0gam9pbiAtIEpvaW4gY2xhdXNlIG9yIGpvaW4gZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIGpvaW5zLlxuICAgKi9cbiAgam9pbnMoam9pbikge1xuICAgIGlmICh0eXBlb2Ygam9pbiA9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aGlzLl9qb2lucy5wdXNoKG5ldyBKb2luUGxhaW4oam9pbikpXG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGpvaW4pKSB7XG4gICAgICB0aGlzLl9qb2lucy5wdXNoKG5ldyBKb2luT2JqZWN0KG5vcm1hbGl6ZUpvaW5PYmplY3Qoam9pbikpKVxuICAgIH0gZWxzZSBpZiAoaXNQbGFpbk9iamVjdChqb2luKSkge1xuICAgICAgdGhpcy5fam9pbnMucHVzaChuZXcgSm9pbk9iamVjdChub3JtYWxpemVKb2luT2JqZWN0KGpvaW4pKSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHR5cGUgb2Ygam9pbjogJHt0eXBlb2Ygam9pbn1gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaW1pdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGUgbGltaXQuXG4gICAqL1xuICBsaW1pdCh2YWx1ZSkge1xuICAgIHRoaXMuX2xpbWl0ID0gdmFsdWVcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb2Zmc2V0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBvZmZzZXQuXG4gICAqL1xuICBvZmZzZXQodmFsdWUpIHtcbiAgICB0aGlzLl9vZmZzZXQgPSB2YWx1ZVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcmRlci5cbiAgICogQHBhcmFtIHtPcmRlckFyZ3VtZW50VHlwZX0gb3JkZXIgLSBPcmRlci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIG9yZGVyLlxuICAgKi9cbiAgb3JkZXIob3JkZXIpIHtcbiAgICBpZiAodHlwZW9mIG9yZGVyID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRoaXMuX29yZGVycy5wdXNoKG5ldyBPcmRlclBsYWluKHRoaXMsIG9yZGVyKSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvcmRlciA9PSBcIm51bWJlclwiKSB7XG4gICAgICB0aGlzLl9vcmRlcnMucHVzaChuZXcgT3JkZXJQbGFpbih0aGlzLCBgJHtvcmRlcn1gKSlcbiAgICB9IGVsc2UgaWYgKG9yZGVyIGluc3RhbmNlb2YgT3JkZXJCYXNlKSB7XG4gICAgICB0aGlzLl9vcmRlcnMucHVzaChvcmRlcilcbiAgICB9IGVsc2UgaWYgKGlzUGxhaW5PYmplY3Qob3JkZXIpKSB7XG4gICAgICB0aGlzLl9vcmRlcnMucHVzaChuZXcgT3JkZXJDb2x1bW4odGhpcywgb3JkZXIpKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3JkZXIgdHlwZTogJHt0eXBlb2Ygb3JkZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSBQYWdlIG51bWJlci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHBhZ2UuXG4gICAqL1xuICBwYWdlKHBhZ2VOdW1iZXIpIHtcbiAgICB0aGlzLl9wYWdlID0gcGFnZU51bWJlclxuICAgIHRoaXMuX2FwcGx5UGFnaW5hdGlvbigpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlciBwYWdlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHBlciBwYWdlLlxuICAgKi9cbiAgcGVyUGFnZShwZXJQYWdlKSB7XG4gICAgdGhpcy5fcGVyUGFnZSA9IHBlclBhZ2VcbiAgICB0aGlzLl9hcHBseVBhZ2luYXRpb24oKVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmUtZGVyaXZlIExJTUlUIGFuZCBPRkZTRVQgZnJvbSB3aGljaGV2ZXIgb2YgYF9wYWdlYCAvIGBfcGVyUGFnZWBcbiAgICogYXJlIGN1cnJlbnRseSBzZXQuIENhbGxlZCBmcm9tIGJvdGggYHBhZ2UoKWAgYW5kIGBwZXJQYWdlKClgIHNvIHRoZVxuICAgKiBjaGFpbmluZyBvcmRlciAoYHBhZ2UobikucGVyUGFnZShwcClgIHZzIGBwZXJQYWdlKHBwKS5wYWdlKG4pYCkgbm9cbiAgICogbG9uZ2VyIGRldGVybWluZXMgd2hpY2ggcGVyUGFnZSB2YWx1ZSB3aW5zIOKAlCB0aGUgbGFzdCB2YWx1ZSBvZlxuICAgKiBlYWNoIHNldHRlciBhbHdheXMgdGFrZXMgZWZmZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseVBhZ2luYXRpb24oKSB7XG4gICAgaWYgKHRoaXMuX3BhZ2UgPT0gbnVsbCkgcmV0dXJuXG5cbiAgICBjb25zdCBwZXJQYWdlID0gdGhpcy5fcGVyUGFnZSB8fCAzMFxuICAgIGNvbnN0IG9mZnNldCA9ICh0aGlzLl9wYWdlIC0gMSkgKiBwZXJQYWdlXG5cbiAgICB0aGlzLmxpbWl0KHBlclBhZ2UpXG4gICAgdGhpcy5vZmZzZXQob2Zmc2V0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVvcmRlci5cbiAgICogQHBhcmFtIHtPcmRlckFyZ3VtZW50VHlwZX0gb3JkZXIgLSBPcmRlci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHJlb3JkZXIuXG4gICAqL1xuICByZW9yZGVyKG9yZGVyKSB7XG4gICAgdGhpcy5fb3JkZXJzID0gW11cbiAgICB0aGlzLm9yZGVyKG9yZGVyKVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXZlcnNlIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGUgcmV2ZXJzZSBvcmRlci5cbiAgICovXG4gIHJldmVyc2VPcmRlcigpIHtcbiAgICBmb3IgKGNvbnN0IG9yZGVyIG9mIHRoaXMuX29yZGVycykge1xuICAgICAgb3JkZXIuc2V0UmV2ZXJzZU9yZGVyKHRydWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3RpbmN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBkaXN0aW5jdC5cbiAgICovXG4gIGRpc3RpbmN0KHZhbHVlID0gdHJ1ZSkge1xuICAgIHRoaXMuX2Rpc3RpbmN0ID0gdmFsdWVcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBjdXJyZW50IHNldCBvZiBgU0VMRUNUYCBjbGF1c2VzIHdpdGggdGhlIGdpdmVuIG9uZXMuXG4gICAqIEVxdWl2YWxlbnQgdG8gY2FsbGluZyBgc2VsZWN0KC4uLilgIGFmdGVyIGZpcnN0IHdpcGluZyBhbnkgcHJldmlvdXNseVxuICAgKiBhY2N1bXVsYXRlZCBzZWxlY3RzIOKAlCBtaXJyb3JzIEFjdGl2ZSBSZWNvcmQncyBgcmVzZWxlY3RgLiBQYXNzIG5vXG4gICAqIGFyZ3VtZW50IChvciBhbiBlbXB0eSBhcnJheSkgdG8gZHJvcCB0aGUgcHJvamVjdGlvbiBlbnRpcmVseSBzbyB0aGVcbiAgICogZHJpdmVyIGZhbGxzIGJhY2sgdG8gaXRzIGRlZmF1bHQgYFNFTEVDVCAqYC5cbiAgICogQHBhcmFtIHtTZWxlY3RBcmd1bWVudFR5cGV9IFtzZWxlY3RdIC0gU2VsZWN0IHRvIHJlcGxhY2UgZXhpc3Rpbmcgc2VsZWN0cyB3aXRoLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGUgcXVlcnkgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgcmVzZWxlY3Qoc2VsZWN0KSB7XG4gICAgdGhpcy5fc2VsZWN0cyA9IFtdXG5cbiAgICBpZiAodHlwZW9mIHNlbGVjdCA9PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gdGhpc1xuXG4gICAgcmV0dXJuIHRoaXMuc2VsZWN0KHNlbGVjdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHBhcmFtIHtTZWxlY3RBcmd1bWVudFR5cGV9IHNlbGVjdCAtIFNlbGVjdC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHNlbGVjdC5cbiAgICovXG4gIHNlbGVjdChzZWxlY3QpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3QpKSB7XG4gICAgICBmb3IgKGNvbnN0IHNlbGVjdEluQXJyYXkgb2Ygc2VsZWN0KSB7XG4gICAgICAgIHRoaXMuc2VsZWN0KHNlbGVjdEluQXJyYXkpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBzZWxlY3QgPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhpcy5fc2VsZWN0cy5wdXNoKG5ldyBTZWxlY3RQbGFpbihzZWxlY3QpKVxuICAgIH0gZWxzZSBpZiAoc2VsZWN0IGluc3RhbmNlb2YgU2VsZWN0QmFzZSkge1xuICAgICAgdGhpcy5fc2VsZWN0cy5wdXNoKHNlbGVjdClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlbGVjdCB0eXBlOiAke3R5cGVvZiBzZWxlY3R9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MubG9nTmFtZV0gLSBRdWVyeSBsb2cgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8b2JqZWN0Pj59IEFycmF5IG9mIHJlc3VsdHMgZnJvbSB0aGUgZGF0YWJhc2VcbiAgICovXG4gIGFzeW5jIF9leGVjdXRlUXVlcnkoe2xvZ05hbWUgPSB0aGlzLnF1ZXJ5TG9nTmFtZShcIkxvYWRcIil9ID0ge30pIHtcbiAgICBjb25zdCBzcWwgPSB0aGlzLnRvU3FsKClcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5kcml2ZXIucXVlcnkoc3FsLCB7bG9nTmFtZSwgc2lnbmFsOiB0aGlzLl9zaWduYWx9KVxuXG4gICAgcmV0dXJuIHJlc3VsdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBzaWduYWwgdXNlZCB0byBjYW5jZWwgZGF0YWJhc2UgZXhlY3V0aW9uIGZvciB0aGlzIHF1ZXJ5IGFuZCBpdHMgY2xvbmVzLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSBzaWduYWwgLSBDYW5jZWxsYXRpb24gc2lnbmFsLCBvciB1bmRlZmluZWQgdG8gY2xlYXIgaXQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IGZvciBjaGFpbmluZy5cbiAgICovXG4gIHNpZ25hbChzaWduYWwpIHtcbiAgICB0aGlzLl9zaWduYWwgPSBzaWduYWxcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXN1bHRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxvYmplY3Q+Pn0gQXJyYXkgb2YgcmVzdWx0cyBmcm9tIHRoZSBkYXRhYmFzZVxuICAgKi9cbiAgYXN5bmMgcmVzdWx0cygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fZXhlY3V0ZVF1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGxvZyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uIC0gUXVlcnkgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXJ5IGxvZyBuYW1lLlxuICAgKi9cbiAgcXVlcnlMb2dOYW1lKG9wZXJhdGlvbikge1xuICAgIHZvaWQgb3BlcmF0aW9uXG4gICAgcmV0dXJuIFwiU1FMXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZXMgU1FMIHN0cmluZyByZXByZXNlbnRpbmcgdGhpcyBxdWVyeVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTUUwgc3RyaW5nIHJlcHJlc2VudGluZyB0aGlzIHF1ZXJ5XG4gICAqL1xuICB0b1NxbCgpIHsgcmV0dXJuIHRoaXMuZHJpdmVyLnF1ZXJ5VG9TcWwodGhpcykgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAcGFyYW0ge1doZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmUod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRoaXMuX3doZXJlcy5wdXNoKG5ldyBXaGVyZVBsYWluKHRoaXMsIHdoZXJlKSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB3aGVyZSA9PSBcIm9iamVjdFwiICYmICh3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lID09IFwib2JqZWN0XCIgfHwgd2hlcmUuY29uc3RydWN0b3IubmFtZSA9PSBcIk9iamVjdFwiKSkge1xuICAgICAgdGhpcy5fd2hlcmVzLnB1c2gobmV3IFdoZXJlSGFzaCh0aGlzLCAvKiogQHR5cGUge2ltcG9ydChcIi4vd2hlcmUtaGFzaC5qc1wiKS5XaGVyZUhhc2h9ICovICh3aGVyZSkpKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdHlwZSBvZiB3aGVyZTogJHt0eXBlb2Ygd2hlcmV9ICgke3doZXJlLmNvbnN0cnVjdG9yLm5hbWV9KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlIG5vdC5cbiAgICogQHBhcmFtIHtXaGVyZUFyZ3VtZW50VHlwZX0gd2hlcmUgLSBXaGVyZS5cbiAgICogQHJldHVybnMge3RoaXN9IFRoaXMgcXVlcnkgaW5zdGFuY2VcbiAgICovXG4gIHdoZXJlTm90KHdoZXJlKSB7XG4gICAgaWYgKHR5cGVvZiB3aGVyZSA9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVOb3QobmV3IFdoZXJlUGxhaW4odGhpcywgd2hlcmUpKSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB3aGVyZSA9PSBcIm9iamVjdFwiICYmICh3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lID09IFwib2JqZWN0XCIgfHwgd2hlcmUuY29uc3RydWN0b3IubmFtZSA9PSBcIk9iamVjdFwiKSkge1xuICAgICAgdGhpcy5fd2hlcmVzLnB1c2gobmV3IFdoZXJlTm90KG5ldyBXaGVyZUhhc2godGhpcywgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3doZXJlLWhhc2guanNcIikuV2hlcmVIYXNofSAqLyAod2hlcmUpKSkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0eXBlIG9mIHdoZXJlOiAke3R5cGVvZiB3aGVyZX0gKCR7d2hlcmUuY29uc3RydWN0b3IubmFtZX0pYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjdXJyZW50IGRyaXZlciBsYXppbHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBBIHZhbHVlLlxuICAgKi9cbiAgZ2V0IGRyaXZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fZHJpdmVyRm4oKVxuICB9XG59XG4iXX0=