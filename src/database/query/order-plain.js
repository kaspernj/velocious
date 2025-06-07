import OrderBase from "./order-base.js"

export default class VelociousDatabaseQueryOrderPlain extends OrderBase {
  constructor({plain}) {
    super()
    this.plain = plain
    this.reverseOrder = false
  }

  setReverseOrder() {
    this.reverseOrder = true
  }

  toSql() {
    if (this.reverseOrder) {
      return `${this.plain} DESC`
    }

    return this.plain
  }
}
