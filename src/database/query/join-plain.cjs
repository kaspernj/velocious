const JoinBase = require("./join-base.cjs")

module.exports = class VelociousDatabaseQueryJoinPlain extends JoinBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
