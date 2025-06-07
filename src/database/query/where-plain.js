import WhereBase from "./where-base.js"

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  constructor(query, plain) {
    super()
    this.plain = plain
    this.query = query
  }

  toSql() {
    return this.plain
  }
}
