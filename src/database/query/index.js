// @ts-check

import FromPlain from "./from-plain.js"
import {isPlainObject} from "is-plain-object"
import JoinObject from "./join-object.js"
import JoinPlain from "./join-plain.js"
import {Logger} from "../../logger.js"
import OrderPlain from "./order-plain.js"
import SelectBase from "./select-base.js"
import SelectPlain from "./select-plain.js"
import WhereHash from "./where-hash.js"
import WherePlain from "./where-plain.js"

/**
 * @typedef {{[key: string]: boolean | NestedPreloadRecord }} NestedPreloadRecord
 * @typedef {string | string[] | import("./select-base.js").default | import("./select-base.js").default[]} SelectArgumentType
 * @typedef {object | string} WhereArgumentType
 */

/**
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
 * @property {Array<import("./select-base.js").default>} [selects] - SELECT clauses for the query.
 * @property {boolean} [distinct] - Whether the query should use DISTINCT.
 * @property {Array<import("./where-base.js").default>} [wheres] - WHERE conditions for the query.
 */

export default class VelociousDatabaseQuery {
  /**
   * @param {QueryArgsType} args
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
    distinct = false,
    selects = [],
    wheres = []
  }) {
    if (!driver) throw new Error("No driver given to query")
    if (!handler) throw new Error("No handler given to query")

    /** @type {() => import("../drivers/base.js").default} */
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
    this._distinct = distinct
    this._selects = selects

    /** @type {import("./where-base.js").default[]} */
    this._wheres = wheres
  }

  /** @returns {this} - The clone.  */
  clone() {
    const QueryClass = /** @type {new (args: QueryArgsType) => this} */ (this.constructor)
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

  /** @returns {import("./from-base.js").default[]} - The froms.  */
  getFroms() {
    return this._froms
  }

  /** @returns {string[]} - The groups.  */
  getGroups() {
    return this._groups
  }

  /** @returns {import("../query-parser/options.js").default} - The options options.  */
  getOptions() { return this.driver.options() }

  /** @returns {Array<import("./select-base.js").default>} - The selects.  */
  getSelects() { return this._selects }

  /**
   * @param {string|import("./from-base.js").default} from
   * @returns {this} - The from.
   */
  from(from) {
    if (typeof from == "string") from = new FromPlain(from)

    this._froms.push(from)
    return this
  }

  /**
   * @param {string} group
   * @returns {this} - The group.
   */
  group(group) {
    this._groups.push(group)
    return this
  }

  /**
   * @param {string|{[key: string]: any}} join
   * @returns {this} - The joins.
   */
  joins(join) {
    if (typeof join == "string") {
      this._joins.push(new JoinPlain(join))
    } else if (isPlainObject(join)) {
      this._joins.push(new JoinObject(join))
    } else {
      throw new Error(`Unknown type of join: ${typeof join}`)
    }

    return this
  }

  /**
   * @param {number} value
   * @returns {this} - The limit.
   */
  limit(value) {
    this._limit = value
    return this
  }

  /**
   * @param {number} value
   * @returns {this} - The offset.
   */
  offset(value) {
    this._offset = value
    return this
  }

  /**
   * @param {string | number} order
   * @returns {this} - The order.
   */
  order(order) {
    if (typeof order == "string") {
      this._orders.push(new OrderPlain(this, order))
    } else if (typeof order == "number") {
      this._orders.push(new OrderPlain(this, `${order}`))
    } else {
      throw new Error(`Unknown order type: ${typeof order}`)
    }

    return this
  }

  /**
   * @param {number} pageNumber
   * @returns {this} - The page.
   */
  page(pageNumber) {
    const perPage = this._perPage || 30
    const offset = (pageNumber - 1) * perPage
    const limit = perPage

    this._page = pageNumber
    this.limit(limit)
    this.offset(offset)
    return this
  }

  /**
   * @param {number} perPage
   * @returns {this} - The per page.
   */
  perPage(perPage) {
    this._perPage = perPage
    return this
  }

  /**
   * @param {string | number} order
   * @returns {this} - The reorder.
   */
  reorder(order) {
    this._orders = []
    this.order(order)
    return this
  }

  /** @returns {this} - The reverse order.  */
  reverseOrder() {
    for (const order of this._orders) {
      order.setReverseOrder(true)
    }

    return this
  }

  /**
   * @param {boolean} [value]
   * @returns {this} - The distinct.
   */
  distinct(value = true) {
    this._distinct = value
    return this
  }

  /**
   * @param {SelectArgumentType} select
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
   * @returns {Promise<Array<object>>} Array of results from the database
   */
  async _executeQuery() {
    const sql = this.toSql()
    const results = await this.driver.query(sql)

    this.logger.debug(() => ["SQL:", sql])

    return results
  }

  /** @returns {Promise<Array<object>>} Array of results from the database */
  async results() {
    return await this._executeQuery()
  }

  /**
   * Generates SQL string representing this query
   * @returns {string} SQL string representing this query
   */
  toSql() { return this.driver.queryToSql(this) }

  /**
   * @param {WhereArgumentType} where
   * @returns {this} This query instance
   */
  where(where) {
    if (typeof where == "string") {
      this._wheres.push(new WherePlain(this, where))
    } else if (typeof where == "object" && (where.constructor.name == "object" || where.constructor.name == "Object")) {
      this._wheres.push(new WhereHash(this, where))
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
