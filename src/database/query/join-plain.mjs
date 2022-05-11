import JoinBase from "./join-base.mjs"

export default class VelociousDatabaseQueryJoinPlain extends JoinBase {
  constructor({plain}) {
    super()
    this.plain = plain
  }

  toSql() {
    return this.plain
  }
}
