module.exports = class VelociousDatabaseQuery {
  constructor({handler}) {
    if (!handler) throw new Error("No handler given")

    this._froms = []
    this._joins = []
    this._orders = []
    this._selects = []
  }

  from(from) {
    this._froms.push(from)
    return this
  }

  joins(join) {
    this._joins.push(join)
    return this
  }

  order(order) {
    this._orders.push(order)
    return this
  }

  select(select) {
    this._selects.push(select)
    return this
  }

  toSql() {

  }
}
