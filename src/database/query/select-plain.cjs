const SelectBase = require("./select-base.cjs")

module.exports = class VelociousDatabaseQuerySelectPlain extends SelectBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
