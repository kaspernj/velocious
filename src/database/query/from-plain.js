// @ts-check

import FromBase from "./from-base.js"

export default class VelociousDatabaseQueryFromPlain extends FromBase {
  /**
 * Runs constructor.
   * @param {string} plain - Plain.
   */
  constructor(plain) {
    super()
    this.plain = plain
  }

  toSql() { return [this.plain] }
}
