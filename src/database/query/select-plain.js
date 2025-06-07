import SelectBase from "./select-base.js"

export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
