export default class VelociousDatabaseQueryBase {
  constructor({driver}) {
    this.driver = driver
  }

  getDriver = () => this.driver
  getOptions = () => this.getDriver()?.options()

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
