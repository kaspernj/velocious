import FromPlain from "./from-plain.mjs"
import JoinPlain from "./join-plain.mjs"
import OrderPlain from "./order-plain.mjs"
import SelectPlain from "./select-plain.mjs"

export default class VelociousDatabaseQuery {
  constructor({driver, froms = [], joins = [], handler, limits = [], modelClass, orders = [], selects = [], wheres = []}) {
    if (!driver) throw new Error("No driver given")
    if (!handler) throw new Error("No handler given")

    this.driver = driver
    this.handler = handler
    this.modelClass = modelClass
    this._froms = froms
    this._joins = joins
    this._limits = limits
    this._orders = orders
    this._selects = selects
    this._wheres = wheres
  }

  clone() {
    const newQuery = new VelociousDatabaseQuery({
      driver: this.driver,
      froms: [...this._froms],
      handler: this.handler.clone(),
      joins: [...this._joins],
      limits: [...this._limits],
      modelClass: this.modelClass,
      orders: [...this._orders],
      selects: [...this._selects],
      wheres: [...this._wheres]
    })

    return newQuery
  }

  getOptions() {
    return this.driver.options()
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

  limit(value) {
    this._limits.push(value)
    return this
  }

  joins(join) {
    if (typeof join == "string") join = new JoinPlain({plain: join, query: this})

    join.query = this

    this._joins.push(join)
    return this
  }

  order(order) {
    if (typeof order == "number" || typeof order == "string") order = new OrderPlain({plain: order, query: this})

    order.query = this

    this._orders.push(order)
    return this
  }

  reorder(order) {
    this._orders = []
    this.order(order)
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

  async toArray() {
    const sql = this.toSql()
    const results = await this.driver.query(sql)
    const models = []

    for (const result of results) {
      const model = new this.modelClass(result)

      models.push(model)
    }

    return models
  }

  toSql() {
    return this.driver.queryToSql(this)
  }

  where(where) {
    if (typeof where == "string") {
      where = new WherePlain({plain: where})
    } else if (typeof where == "object" && where.constructor.name == "object") {
      where = new WhereHash({hash: where})
    }

    this._wheres.push(where)
    return this
  }
}
