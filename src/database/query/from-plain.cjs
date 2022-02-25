const FromBase = require("./from-base.cjs")

module.exports = class VelociousDatabaseQueryFromPlain extends FromBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
