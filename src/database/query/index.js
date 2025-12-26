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
 * @property {import("../drivers/base.js").default | (() => import("../drivers/base.js").default)} driver - Description.
 * @property {Array<import("./from-base.js").default>} [froms] - Description.
 * @property {string[]} [groups] - Description.
 * @property {Array<import("./join-base.js").default>} [joins] - Description.
 * @property {import("../handler.js").default} handler - Description.
 * @property {number | null} [limit] - Description.
 * @property {number | null} [offset] - Description.
 * @property {Array<import("./order-base.js").default>} [orders] - Description.
 * @property {number | null} [page] - Description.
 * @property {number} [perPage] - Description.
 * @property {NestedPreloadRecord} [preload] - Description.
 * @property {Array<import("./select-base.js").default>} [selects] - Description.
 * @property {boolean} [distinct] - Description.
 * @property {Array<import("./where-base.js").default>} [wheres] - Description.
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

  /** @returns {this} - Result.  */
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

  /** @returns {import("./from-base.js").default[]} - Result.  */
  getFroms() {
    return this._froms
  }

  /** @returns {string[]} - Result.  */
  getGroups() {
    return this._groups
  }

  /** @returns {import("../query-parser/options.js").default} - Result.  */
  getOptions() { return this.driver.options() }

  /** @returns {Array<import("./select-base.js").default>} - Result.  */
  getSelects() { return this._selects }

  /**
   * @param {string|import("./from-base.js").default} from
   * @returns {this} - Result.
   */
  from(from) {
    if (typeof from == "string") from = new FromPlain(from)

    this._froms.push(from)
    return this
  }

  /**
   * @param {string} group
   * @returns {this} - Result.
   */
  group(group) {
    this._groups.push(group)
    return this
  }

  /**
   * @param {string|{[key: string]: any}} join
   * @returns {this} - Result.
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
   * @returns {this} - Result.
   */
  limit(value) {
    this._limit = value
    return this
  }

  /**
   * @param {number} value
   * @returns {this} - Result.
   */
  offset(value) {
    this._offset = value
    return this
  }

  /**
   * @param {string | number} order
   * @returns {this} - Result.
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
   * @returns {this} - Result.
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
   * @returns {this} - Result.
   */
  perPage(perPage) {
    this._perPage = perPage
    return this
  }

  /**
   * @param {string | number} order
   * @returns {this} - Result.
   */
  reorder(order) {
    this._orders = []
    this.order(order)
    return this
  }

  /** @returns {this} - Result.  */
  reverseOrder() {
    for (const order of this._orders) {
      order.setReverseOrder(true)
    }

    return this
  }

  /**
   * @param {boolean} [value]
   * @returns {this} - Result.
   */
  distinct(value = true) {
    this._distinct = value
    return this
  }

  /**
   * @param {SelectArgumentType} select
   * @returns {this} - Result.
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
   * @returns {import("../drivers/base.js").default} - Result.
   */
  get driver() {
    return this._driverFn()
  }
}
