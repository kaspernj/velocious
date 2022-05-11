import OrderBase from "./order-base.mjs"

export default class VelociousDatabaseQueryOrderPlain extends OrderBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
