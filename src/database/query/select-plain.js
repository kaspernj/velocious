// @ts-check

import SelectBase from "./select-base.js"

export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
  /**
   * @param {string} plain - Plain.
   */
  constructor(plain) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
