const FromPlain = require("./from-plain.cjs")
const JoinPlain = require("./join-plain.cjs")
const SelectPlain = require("./select-plain.cjs")

module.exports = class VelociousDatabaseQuery {
  constructor({driver, handler}) {
    if (!driver) throw new Error("No driver given")
    if (!handler) throw new Error("No handler given")

    this.driver = driver
    this._froms = []
    this._joins = []
    this._orders = []
    this._selects = []
  }

  getOptions() {
    return this.driver.options()
  }

  from(from) {
    if (typeof from == "string") from = new FromPlain({plain: from, query: this})

    from.query = this

    this._froms.push(from)
    return this
  }

  joins(join) {
    if (typeof join == "string") join = new JoinPlain({plain: join, query: this})

    join.query = this

    this._joins.push(join)
    return this
  }

  order(order) {
    if (typeof order == "string") order = new OrderPlain({plain: order, query: this})

    order.query = this

    this._orders.push(order)
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

  toSql() {
    throw new Error("stub")
  }
}
