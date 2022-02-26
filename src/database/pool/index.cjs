const Configuration = require("../../configuration.cjs")
const {digg} = require("diggerize")

module.exports = class VelociousDatabasePool {
  static current() {
    if (!global.velociousDatabasePool) global.velociousDatabasePool = new VelociousDatabasePool()

    return global.velociousDatabasePool
  }

  checkout() {
    // How do we keep track of which "threads" have a database connection?
    // Return a single connection per worker for now

    return this.singleConnection()
  }

  checkin() {
    // How do we keep track of which "threads" have a database connection?
  }

  singleConnection() {
    if (!this.connection) this.spawnConnection()

    return this.connection
  }

  spawnConnection() {
    const databaseConfigPath = `${Configuration.current().directory}/src/config/database.cjs`
    const {databaseConfiguration} = require(databaseConfigPath)
    const config = databaseConfiguration()
    const driverPath = `../drivers/${digg(config, "type")}/index.cjs`
    const DriverClass = require(driverPath)
    const connection = new DriverClass(config)

    return connection
  }
}
