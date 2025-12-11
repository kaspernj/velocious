// @ts-check

import WhereBase from "./where-base.js"

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  /**
   * @param {import("./index.js").default} query
   * @param {string} plain
   */
  constructor(query, plain) {
    super()
    this.plain = plain
    this.query = query
  }

  toSql() {
    return this.plain
  }
}
