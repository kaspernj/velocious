import QueryBase from "./base.js"

export default class VelociousDatabaseQueryDeleteBase extends QueryBase {
  constructor({conditions, driver, tableName}) {
    super({driver})
    this.conditions = conditions
    this.tableName = tableName
  }
}
