// @ts-check

import QueryBase from "./base.js"

export default class VelociousDatabaseQueryDeleteBase extends QueryBase {
  /**
   * @param {object} args
   * @param {Record<string, any>} args.conditions
   * @param {import("../drivers/base.js").default} args.driver
   * @param {string} args.tableName
   */
  constructor({conditions, driver, tableName}) {
    super({driver})
    this.conditions = conditions
    this.tableName = tableName
  }
}
