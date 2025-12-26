// @ts-check

import QueryBase from "./base.js"

export default class VelociousDatabaseQueryDeleteBase extends QueryBase {
  /**
   * @param {object} args - Options object.
   * @param {Record<string, unknown>} args.conditions - Conditions.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {string} args.tableName - Table name.
   */
  constructor({conditions, driver, tableName}) {
    super({driver})
    this.conditions = conditions
    this.tableName = tableName
  }
}
