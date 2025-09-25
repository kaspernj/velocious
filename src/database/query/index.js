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

export default class VelociousDatabaseQuery {
  constructor({driver, froms = [], groups = [], joins = [], handler, limits = [], modelClass, orders = [], preload = {}, selects = [], wheres = []}) {
    if (!driver) throw new Error("No driver given to query")
    if (!handler) throw new Error("No handler given to query")

    this.driver = driver
    this.handler = handler
    this.logger = new Logger(this)
    this.modelClass = modelClass
    this._froms = froms
    this._groups = groups
    this._joins = joins
    this._limits = limits
    this._orders = orders
    this._preload = preload
    this._selects = selects
    this._wheres = wheres
  }

  clone() {
    const newQuery = new VelociousDatabaseQuery({
      driver: this.driver,
      froms: [...this._froms],
      handler: this.handler.clone(),
      groups: [...this._groups],
      joins: [...this._joins],
      limits: [...this._limits],
      modelClass: this.modelClass,
      orders: [...this._orders],
      preload: {...this._preload},
      selects: [...this._selects],
      wheres: [...this._wheres]
    })

    return newQuery
  }

  async count() {
    // Generate count SQL
    let sql = "COUNT(id)"

    if (this.driver.getType() == "pgsql") sql += "::int"

    sql += " AS count"


    // Clone query and execute count
    const countQuery = this.clone()

    countQuery._selects = []
    countQuery.select(sql)

    const results = await countQuery._executeQuery()

    if (results.length == 1) {
      return results[0].count
    }

    throw new Error("count multiple stub")
  }

  getOptions() { return this.driver.options() }

  async destroyAll() {
    const records = await this.toArray()

    for (const record of records) {
      await record.destroy()
    }
  }

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

  async findBy(conditions) {
    const newConditions = {}

    for (const key in conditions) {
      const keyUnderscore = inflection.underscore(key)

      newConditions[keyUnderscore] = conditions[key]
    }

    return await this.clone().where(newConditions).first()
  }

  async findOrCreateBy(...args) {
    const record = await this.findOrInitializeBy(...args)

    if (record.isNewRecord()) {
      await record.save()
    }

    return record
  }

  async findOrInitializeBy(conditions, callback) {
    const record = await this.findBy(conditions)

    if (record) return record

    const newRecord = new this.modelClass(conditions)

    if (callback) {
      callback(newRecord)
    }

    return newRecord
  }

  async first() {
    const newQuery = this.clone()
    const results = await newQuery.limit(1).reorder(this.modelClass.orderableColumn()).toArray()

    return results[0]
  }

  from(from) {
    if (typeof from == "string") from = new FromPlain({plain: from, query: this})

    from.query = this

    this._froms.push(from)
    return this
  }

  group(group) {
    this._groups.push(group)
    return this
  }

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

  last = async () => {
    const results = await this.clone().reorder("id DESC").limit(1).toArray()

    return results[0]
  }

  limit(value) {
    this._limits.push(value)
    return this
  }

  order(order) {
    if (typeof order == "number" || typeof order == "string") order = new OrderPlain({plain: order, query: this})

    order.query = this

    this._orders.push(order)
    return this
  }

  preload(data) {
    incorporate(this._preload, data)
    return this
  }

  reorder(order) {
    this._orders = []
    this.order(order)
    return this
  }

  reverseOrder() {
    for (const order of this._orders) {
      order.setReverseOrder(true)
    }

    return this
  }

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

  async _executeQuery() {
    const sql = this.toSql()
    const results = await this.driver.query(sql)

    this.logger.debug("SQL:", sql)

    return results
  }

  async results() {
    return await this._executeQuery()
  }

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

  toSql() { return this.driver.queryToSql(this) }

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
