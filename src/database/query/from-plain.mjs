import FromBase from "./from-base.mjs"

export default class VelociousDatabaseQueryFromPlain extends FromBase {
  constructor({driver, plain}) {
    super({driver})
    this.plain = plain
  }

  toSql = () => this.plain
}
