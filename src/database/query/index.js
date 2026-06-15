// @ts-check

import FromPlain from "./from-plain.js"
import {isPlainObject} from "is-plain-object"
import JoinObject from "./join-object.js"
import JoinPlain from "./join-plain.js"
import Logger from "../../logger.js"
import OrderBase from "./order-base.js"
import OrderColumn from "./order-column.js"
import OrderPlain from "./order-plain.js"
import SelectBase from "./select-base.js"
import SelectPlain from "./select-plain.js"
import WhereHash from "./where-hash.js"
import WhereNot from "./where-not.js"
import WherePlain from "./where-plain.js"

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
  if (!join) return {}

  if (typeof join == "string") {
    return {[join]: true}
  }

  if (Array.isArray(join)) {
    /**
     * Result.
     * @type {import("./join-object.js").JoinObject} */
    const result = {}

    for (const entry of join) {
      if (typeof entry == "string") {
        const existing = result[entry]
        result[entry] = mergeJoinValue(existing, true)
        continue
      }

      if (isPlainObject(entry)) {
        const normalized = normalizeJoinObject(entry)

        for (const [key, value] of Object.entries(normalized)) {
          const existing = result[key]
          result[key] = mergeJoinValue(existing, value)
        }
        continue
      }

      throw new Error(`Invalid join entry type: ${typeof entry}`)
    }

    return result
  }

  if (!isPlainObject(join)) {
    throw new Error(`Invalid join type: ${typeof join}`)
  }

  /**
   * Result.
   * @type {import("./join-object.js").JoinObject} */
  const result = {}

  for (const [key, value] of Object.entries(join)) {
    if (value === true || value === false) {
      const existing = result[key]
      result[key] = mergeJoinValue(existing, value)
      continue
    }

    if (typeof value == "string" || Array.isArray(value) || isPlainObject(value)) {
      const existing = result[key]
      result[key] = mergeJoinValue(existing, normalizeJoinObject(value))
      continue
    }

    throw new Error(`Invalid join value for ${key}: ${typeof value}`)
  }

  return result
}

/**
 * Runs merge join value.
 * @param {import("./join-object.js").JoinObject[string] | undefined} existing - Existing normalized join value.
 * @param {import("./join-object.js").JoinObject[string]} incoming - Incoming normalized join value.
 * @returns {import("./join-object.js").JoinObject[string]} - Merged join value.
 */
function mergeJoinValue(existing, incoming) {
  if (!existing) return incoming
  if (existing === true || incoming === true) return true

  if (typeof existing == "object" && typeof incoming == "object") {
    return {...existing, ...incoming}
  }

  return incoming
}

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
 * @property {boolean} [distinct] - Whether the query should use DISTINCT.
 * @property {Array<import("./where-base.js").default>} [wheres] - WHERE conditions for the query.
 */

export default class VelociousDatabaseQuery {
  /**
   * Runs constructor.
   * @param {QueryArgsType} args - Options object.
   */
  constructor({
    driver,
    froms = [],
    groups = [],
    joins = [],
    handler,
    limit = null,
    offset = null,
    orders = [],
    page = null,
    perPage,
    preload = {},
    preloadSelects = {},
    preloadSelectsExtra = {},
    distinct = false,
    selects = [],
    wheres = []
  }) {
    if (!driver) throw new Error("No driver given to query")
    if (!handler) throw new Error("No handler given to query")

    /**
     * Narrows the runtime value to the documented type.
     * @type {() => import("../drivers/base.js").default} */
    this._driverFn = typeof driver === "function" ? driver : () => driver
    this.handler = handler
    this.logger = new Logger(this)
    this._froms = froms
    this._groups = groups
    this._joins = joins
    this._limit = limit
    this._offset = offset
    this._orders = orders
    this._page = page
    this._perPage = perPage
    this._preload = preload

    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    this._preloadSelects = preloadSelects

    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    this._preloadSelectsExtra = preloadSelectsExtra
    this._distinct = distinct
    this._selects = selects

    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./where-base.js").default[]} */
    this._wheres = wheres

    const boundWhere = /**
                        * Narrows the runtime value to the documented type.
                        * @type {?} */ (this.where.bind(this))
    boundWhere.not = this.whereNot.bind(this)
    this.where = boundWhere
  }

  /**
   * Runs clone.
   * @returns {this} - The clone.
   */
  clone() {
    const QueryClass = /**
                        * Narrows the runtime value to the documented type.
                        * @type {new (args: QueryArgsType) => this} */ (this.constructor)
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
      preload: {...this._preload},
      distinct: this._distinct,
      selects: [...this._selects],
      wheres: [...this._wheres]
    })

    return newQuery
  }

  /**
   * Runs get froms.
   * @returns {import("./from-base.js").default[]} - The froms.
   */
  getFroms() {
    return this._froms
  }

  /**
   * Runs get groups.
   * @returns {string[]} - The groups.
   */
  getGroups() {
    return this._groups
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() { return this.driver.options() }

  /**
   * Runs get selects.
   * @returns {Array<import("./select-base.js").default>} - The selects.
   */
  getSelects() { return this._selects }

  /**
   * Runs from.
   * @param {string|import("./from-base.js").default} from - From.
   * @returns {this} - The from.
   */
  from(from) {
    if (typeof from == "string") from = new FromPlain(from)

    this._froms.push(from)
    return this
  }

  /**
   * Runs group.
   * @param {string} group - Group.
   * @returns {this} - The group.
   */
  group(group) {
    this._groups.push(group)
    return this
  }

  /**
   * Runs joins.
   * @param {string | string[] | import("./join-object.js").JoinObjectInput} join - Join clause or join descriptor.
   * @returns {this} - The joins.
   */
  joins(join) {
    if (typeof join == "string") {
      this._joins.push(new JoinPlain(join))
    } else if (Array.isArray(join)) {
      this._joins.push(new JoinObject(normalizeJoinObject(join)))
    } else if (isPlainObject(join)) {
      this._joins.push(new JoinObject(normalizeJoinObject(join)))
    } else {
      throw new Error(`Unknown type of join: ${typeof join}`)
    }

    return this
  }

  /**
   * Runs limit.
   * @param {number} value - Value to use.
   * @returns {this} - The limit.
   */
  limit(value) {
    this._limit = value
    return this
  }

  /**
   * Runs offset.
   * @param {number} value - Value to use.
   * @returns {this} - The offset.
   */
  offset(value) {
    this._offset = value
    return this
  }

  /**
   * Runs order.
   * @param {OrderArgumentType} order - Order.
   * @returns {this} - The order.
   */
  order(order) {
    if (typeof order == "string") {
      this._orders.push(new OrderPlain(this, order))
    } else if (typeof order == "number") {
      this._orders.push(new OrderPlain(this, `${order}`))
    } else if (order instanceof OrderBase) {
      this._orders.push(order)
    } else if (isPlainObject(order)) {
      this._orders.push(new OrderColumn(this, order))
    } else {
      throw new Error(`Unknown order type: ${typeof order}`)
    }

    return this
  }

  /**
   * Runs page.
   * @param {number} pageNumber - Page number.
   * @returns {this} - The page.
   */
  page(pageNumber) {
    this._page = pageNumber
    this._applyPagination()
    return this
  }

  /**
   * Runs per page.
   * @param {number} perPage - Page size.
   * @returns {this} - The per page.
   */
  perPage(perPage) {
    this._perPage = perPage
    this._applyPagination()
    return this
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
    if (this._page == null) return

    const perPage = this._perPage || 30
    const offset = (this._page - 1) * perPage

    this.limit(perPage)
    this.offset(offset)
  }

  /**
   * Runs reorder.
   * @param {OrderArgumentType} order - Order.
   * @returns {this} - The reorder.
   */
  reorder(order) {
    this._orders = []
    this.order(order)
    return this
  }

  /**
   * Runs reverse order.
   * @returns {this} - The reverse order.
   */
  reverseOrder() {
    for (const order of this._orders) {
      order.setReverseOrder(true)
    }

    return this
  }

  /**
   * Runs distinct.
   * @param {boolean} [value] - Value to use.
   * @returns {this} - The distinct.
   */
  distinct(value = true) {
    this._distinct = value
    return this
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
    this._selects = []

    if (typeof select == "undefined") return this

    return this.select(select)
  }

  /**
   * Runs select.
   * @param {SelectArgumentType} select - Select.
   * @returns {this} - The select.
   */
  select(select) {
    if (Array.isArray(select)) {
      for (const selectInArray of select) {
        this.select(selectInArray)
      }

      return this
    }

    if (typeof select == "string") {
      this._selects.push(new SelectPlain(select))
    } else if (select instanceof SelectBase) {
      this._selects.push(select)
    } else {
      throw new Error(`Invalid select type: ${typeof select}`)
    }

    return this
  }

  /**
   * Runs execute query.
   * @param {object} [args] - Options object.
   * @param {string} [args.logName] - Query log name.
   * @returns {Promise<Array<object>>} Array of results from the database
   */
  async _executeQuery({logName = this.queryLogName("Load")} = {}) {
    const sql = this.toSql()
    const results = await this.driver.query(sql, {logName})

    return results
  }

  /**
   * Runs results.
   * @returns {Promise<Array<object>>} Array of results from the database
   */
  async results() {
    return await this._executeQuery()
  }

  /**
   * Runs query log name.
   * @param {string} operation - Query operation.
   * @returns {string} - Query log name.
   */
  queryLogName(operation) {
    void operation
    return "SQL"
  }

  /**
   * Generates SQL string representing this query
   * @returns {string} SQL string representing this query
   */
  toSql() { return this.driver.queryToSql(this) }

  /**
   * Runs where.
   * @param {WhereArgumentType} where - Where.
   * @returns {this} This query instance
   */
  where(where) {
    if (typeof where == "string") {
      this._wheres.push(new WherePlain(this, where))
    } else if (typeof where == "object" && (where.constructor.name == "object" || where.constructor.name == "Object")) {
      this._wheres.push(new WhereHash(this, /**
                                             * Narrows the runtime value to the documented type.
                                             * @type {import("./where-hash.js").WhereHash} */ (where)))
    } else {
      throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`)
    }

    return this
  }

  /**
   * Runs where not.
   * @param {WhereArgumentType} where - Where.
   * @returns {this} This query instance
   */
  whereNot(where) {
    if (typeof where == "string") {
      this._wheres.push(new WhereNot(new WherePlain(this, where)))
    } else if (typeof where == "object" && (where.constructor.name == "object" || where.constructor.name == "Object")) {
      this._wheres.push(new WhereNot(new WhereHash(this, /**
                                                          * Narrows the runtime value to the documented type.
                                                          * @type {import("./where-hash.js").WhereHash} */ (where))))
    } else {
      throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`)
    }

    return this
  }

  /**
   * Resolves the current driver lazily.
   * @returns {import("../drivers/base.js").default} - A value.
   */
  get driver() {
    return this._driverFn()
  }
}
