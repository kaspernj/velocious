// @ts-check

import JoinBase from "./join-base.js"

export default class VelociousDatabaseQueryJoinPlain extends JoinBase {
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
