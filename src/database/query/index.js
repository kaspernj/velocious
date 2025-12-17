// @ts-check

/**
 * @typedef {{[key: string]: boolean | NestedPreloadRecord }} NestedPreloadRecord
 * @typedef {string | string[] | import("./select-base.js").default | import("./select-base.js").default[]} SelectArgumentType
 * @typedef {object | string} WhereArgumentType
 */

import FromPlain from "./from-plain.js"
import {incorporate} from "incorporator"
import {isPlainObject} from "is-plain-object"
import JoinObject from "./join-object.js"
import JoinPlain from "./join-plain.js"
import {Logger} from "../../logger.js"
import OrderPlain from "./order-plain.js"
import SelectBase from "./select-base.js"
import SelectPlain from "./select-plain.js"
import WhereHash from "./where-hash.js"
import WherePlain from "./where-plain.js"
import restArgsError from "../../utils/rest-args-error.js"

/**
 * @typedef {object} QueryArgsType
 * @property {import("../drivers/base.js").default} driver
 * @property {Array<import("./from-base.js").default>} [froms]
 * @property {string[]} [groups]
 * @property {Array<import("./join-base.js").default>} [joins]
 * @property {import("../handler.js").default} handler
 * @property {number | null} [limit]
 * @property {number | null} [offset]
 * @property {Array<import("./order-base.js").default>} [orders]
 * @property {number | null} [page]
 * @property {number} [perPage]
 * @property {NestedPreloadRecord} [preload]
 * @property {Array<import("./select-base.js").default>} [selects]
 * @property {Array<import("./where-base.js").default>} [wheres]
 */

/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} MC
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
    selects = [],
    wheres = [],
    ...restArgs
  }) {
    if (!driver) throw new Error("No driver given to query")
    if (!handler) throw new Error("No handler given to query")

    restArgsError(restArgs)

    this.driver = driver

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
    this._selects = selects

    /** @type {import("./where-base.js").default[]} */
    this._wheres = wheres
  }

  /** @returns {this} */
  clone() {
    const QueryClass = /** @type {new (args: QueryArgsType) => this} */ (this.constructor)
    const newQuery = new QueryClass({
      driver: this.driver,
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
      selects: [...this._selects],
      wheres: [...this._wheres]
    })

    return newQuery
  }

  /** @returns {import("./from-base.js").default[]} */
  getFroms() {
    return this._froms
  }

  /** @returns {string[]} */
  getGroups() {
    return this._groups
  }

  /** @returns {import("../query-parser/options.js").default} */
  getOptions() { return this.driver.options() }

  /** @returns {Array<import("./select-base.js").default>} */
  getSelects() { return this._selects }

  /**
   * @param {string|import("./from-base.js").default} from
   * @returns {this}
   */
  from(from) {
    if (typeof from == "string") from = new FromPlain(from)

    this._froms.push(from)
    return this
  }

  /**
   * @param {string} group
   * @returns {this}
   */
  group(group) {
    this._groups.push(group)
    return this
  }

  /**
   * @param {string|{[key: string]: any}} join
   * @returns {this}
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
   * @returns {this}
   */
  limit(value) {
    this._limit = value
    return this
  }

  /**
   * @param {number} value
   * @returns {this}
   */
  offset(value) {
    this._offset = value
    return this
  }

  /**
   * @param {string | number} order
   * @returns {this}
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
   * @returns {this}
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
   * @returns {this}
   */
  perPage(perPage) {
    this._perPage = perPage
    return this
  }

  /**
   * @param {NestedPreloadRecord} data
   * @returns {this}
   */
  preload(data) {
    incorporate(this._preload, data)
    return this
  }

  /**
   * @param {string | number} order
   * @returns {this}
   */
  reorder(order) {
    this._orders = []
    this.order(order)
    return this
  }

  /** @returns {this} */
  reverseOrder() {
    for (const order of this._orders) {
      order.setReverseOrder(true)
    }

    return this
  }

  /**
   * @param {SelectArgumentType} select
   * @returns {this}
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
}
