import SelectBase from "./select-base.mjs"

export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
