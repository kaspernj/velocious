// @ts-check

import OrderBase from "./order-base.js"

export default class VelociousDatabaseQueryOrderPlain extends OrderBase {
  /**
   * @param {import("./index.js").default} query - Query instance.
   * @param {string} plain - Plain.
   */
  constructor(query, plain) {
    super(query)
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
