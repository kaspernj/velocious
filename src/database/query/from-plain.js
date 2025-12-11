// @ts-check

import FromBase from "./from-base.js"

export default class VelociousDatabaseQueryFromPlain extends FromBase {
  /**
   * @param {string} plain
   */
  constructor(plain) {
    super()
    this.plain = plain
  }

  toSql() { return [this.plain] }
}
