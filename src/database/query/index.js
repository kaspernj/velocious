import FromPlain from "./from-plain.js"
import {incorporate} from "incorporator"
import * as inflection from "inflection"
import JoinPlain from "./join-plain.js"
import {Logger} from "../../logger.js"
import OrderPlain from "./order-plain.js"
import Preloader from "./preloader.js"
import RecordNotFoundError from "../record/record-not-found-error.js"
import SelectPlain from "./select-plain.js"
import WhereHash from "./where-hash.js"
import WherePlain from "./where-plain.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQuery {
  constructor({driver, froms = [], groups = [], joins = [], handler, limit = null, modelClass, offset = null, orders = [], page = null, perPage, preload = {}, selects = [], wheres = [], ...restArgs}) {
    if (!driver) throw new Error("No driver given to query")
    if (!handler) throw new Error("No handler given to query")

    restArgsError(restArgs)

    this.driver = driver
    this.handler = handler
    this.logger = new Logger(this)
    this.modelClass = modelClass
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
    this._wheres = wheres
  }

  /**
   * @returns {VelociousDatabaseQuery}
   */
  clone() {
    const newQuery = new VelociousDatabaseQuery({
      driver: this.driver,
      froms: [...this._froms],
      handler: this.handler.clone(),
      groups: [...this._groups],
      joins: [...this._joins],
      limit: this._limit,
      modelClass: this.modelClass,
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

  /**
   * @returns {Promise<number>}
   */
  async count() {
    // Generate count SQL
    let sql = `COUNT(${this.driver.quoteTable(this.modelClass.tableName())}.${this.driver.quoteColumn(this.modelClass.primaryKey())})`

    if (this.driver.getType() == "pgsql") sql += "::int"

    sql += " AS count"


    // Clone query and execute count
    const countQuery = this.clone()

    countQuery._selects = []
    countQuery.select(sql)

    const results = await countQuery._executeQuery()


    // The query isn't grouped and a single result has been given
    if (results.length == 1) {
      return results[0].count
    }


    // The query may be grouped and a lot of different counts a given
    let countResult = 0

    for (const result of results) {
      if (!("count" in result)) {
        throw new Error("Invalid count result")
      }

      countResult += result.count
    }

    return countResult
  }

  getOptions() { return this.driver.options() }

  /**
   * @returns {Promise<void>}
   */
  async destroyAll() {
    const records = await this.toArray()

    for (const record of records) {
      await record.destroy()
    }
  }

  /**
   * @param {number|string} recordId
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async find(recordId) {
    const conditions = {}

    conditions[this.modelClass.primaryKey()] = recordId

    const query = this.clone().where(conditions)
    const record = await query.first()

    if (!record) {
      throw new RecordNotFoundError(`Couldn't find ${this.modelClass.name} with '${this.modelClass.primaryKey()}'=${recordId}`)
    }

    return record
  }

  /**
   * @param {object} conditions
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async findBy(conditions) {
    const newConditions = {}

    for (const key in conditions) {
      const keyUnderscore = inflection.underscore(key)

      newConditions[keyUnderscore] = conditions[key]
    }

    return await this.clone().where(newConditions).first()
  }

  /**
   * @param {...Parameters<this["findOrInitializeBy"]>} args
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async findOrCreateBy(...args) {
    const record = await this.findOrInitializeBy(...args)

    if (record.isNewRecord()) {
      await record.save()
    }

    return record
  }

  /**
   * @param {object} conditions
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async findByOrFail(conditions) {
    const newConditions = {}

    for (const key in conditions) {
      const keyUnderscore = inflection.underscore(key)

      newConditions[keyUnderscore] = conditions[key]
    }

    const model = await this.clone().where(newConditions).first()

    if (!model) {
      throw new Error("Record not found")
    }

    return model
  }

  /**
   * @param {object} conditions
   * @param {function() : void} callback
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async findOrInitializeBy(conditions, callback) {
    const record = await this.findBy(conditions)

    if (record) return record

    const newRecord = new this.modelClass(conditions)

    if (callback) {
      callback(newRecord)
    }

    return newRecord
  }

  /**
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async first() {
    const newQuery = this.clone().limit(1).reorder(`${this.driver.quoteTable(this.modelClass.tableName())}.${this.driver.quoteColumn(this.modelClass.orderableColumn())}`)
    const results = await newQuery.toArray()

    return results[0]
  }

  /**
   * @param {string|FromPlain} from
   * @returns {this}
   */
  from(from) {
    if (typeof from == "string") from = new FromPlain({plain: from, query: this})

    from.query = this

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
   * @param {string|JoinPlain} join
   * @returns {this}
   */
  joins(join) {
    if (typeof join == "string") {
      join = new JoinPlain({plain: join, query: this})
    } else if (typeof join == "object") {
      // Do nothing
    } else {
      throw new Error(`Unknown type of join: ${typeof join}`)
    }

    this._joins.push(join)
    return this
  }

  /**
   * @returns {Promise<InstanceType<this["modelClass"]>>}
   */
  async last() {
    const primaryKey = this.modelClass.primaryKey()
    const tableName = this.modelClass.tableName()
    const results = await this.clone().reorder(`${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(primaryKey)} DESC`).limit(1).toArray()

    return results[0]
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
   * @param {*} order
   * @returns {this}
   */
  order(order) {
    if (typeof order == "number" || typeof order == "string") order = new OrderPlain({plain: order, query: this})

    order.query = this

    this._orders.push(order)
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
   * @param {string} data
   * @returns {this}
   */
  preload(data) {
    incorporate(this._preload, data)
    return this
  }

  /**
   * @param {string|OrderPlain} order
   * @returns {this}
   */
  reorder(order) {
    this._orders = []
    this.order(order)
    return this
  }

  /**
   * @returns {this}
   */
  reverseOrder() {
    for (const order of this._orders) {
      order.setReverseOrder(true)
    }

    return this
  }

  /**
   * @param {string|SelectPlain} select
   * @returns {this}
   */
  select(select) {
    if (Array.isArray(select)) {
      for (const selectInArray of select) {
        this.select(selectInArray)
      }

      return this
    }

    if (typeof select == "string") select = new SelectPlain({plain: select})

    select.query = this

    this._selects.push(select)
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

  /**
   * @returns {Promise<Array<object>>} Array of results from the database
   */
  async results() {
    return await this._executeQuery()
  }

  /**
   * Converts query results to array of model instances
   * @returns {Promise<Array<InstanceType<this["modelClass"]>>>}
   */
  async toArray() {
    const models = []
    const results = await this.results()

    for (const result of results) {
      const model = new this.modelClass()

      model.loadExistingRecord(result)
      models.push(model)
    }

    if (Object.keys(this._preload).length > 0 && models.length > 0) {
      const preloader = new Preloader({
        modelClass: this.modelClass,
        models,
        preload: this._preload
      })

      await preloader.run()
    }

    return models
  }

  /**
   * Generates SQL string representing this query
   * @returns {string} SQL string representing this query
   */
  toSql() { return this.driver.queryToSql(this) }

  /**
   * @param {object|string} where
   * @returns {VelociousDatabaseQuery} This query instance
   */
  where(where) {
    if (typeof where == "string") {
      where = new WherePlain(this, where)
    } else if (typeof where == "object" && (where.constructor.name == "object" || where.constructor.name == "Object")) {
      where = new WhereHash(this, where)
    } else {
      throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`)
    }

    this._wheres.push(where)

    return this
  }
}
