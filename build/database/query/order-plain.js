// @ts-check

import OrderBase from "./order-base.js"

export default class VelociousDatabaseQueryOrderPlain extends OrderBase {
  /**
   * Runs constructor.
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

  /**
   * Runs reversed copy.
   * @returns {VelociousDatabaseQueryOrderPlain} - A new independent order reversing the effective (rendered) direction; a directionless plain order renders DESC.
   */
  reversedCopy() {
    const effective = this.reverseOrder ? `${this.plain} DESC` : this.plain
    const match = effective.match(/^(.*\S)\s+(ASC|DESC)$/i)

    if (match) {
      const direction = match[2].toUpperCase() == "ASC" ? "DESC" : "ASC"
      return new VelociousDatabaseQueryOrderPlain(this.query, `${match[1]} ${direction}`)
    }

    return new VelociousDatabaseQueryOrderPlain(this.query, `${effective} DESC`)
  }

  toSql() {
    if (this.reverseOrder) {
      return `${this.plain} DESC`
    }

    return this.plain
  }
}
