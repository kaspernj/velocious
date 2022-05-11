import FromBase from "./from-base.mjs"

export default class VelociousDatabaseQueryFromPlain extends FromBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
