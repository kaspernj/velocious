const OrderBase = require("./order-base.cjs")

module.exports = class VelociousDatabaseQueryOrderPlain extends OrderBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
