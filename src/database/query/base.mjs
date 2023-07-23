export default class VelociousDatabaseQueryBase {
  constructor({driver}) {
    this.driver = driver
  }

  getOptions = () => this.driver?.options()

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
