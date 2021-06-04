module.exports = class VelociousDatabaseQuery {
  constructor({handler}) {
    if (!handler) throw new Error("No handler given")

    this._joins = []
    this._orders = []
    this._selects = []
  }

  join(join) {
    this._joins.push(join)
  }

  order(order) {
    this._orders.push(order)
  }

  select(select) {
    this._selects.push(select)
    return this
  }

  toSql() {

  }
}
