import AsyncTrackedMultiConnection from "velocious/src/database/pool/async-tracked-multi-connection.js"
import Configuration from "velocious/src/configuration.js"
import MysqlDriver from "velocious/src/database/drivers/mysql/index.js"

export default new Configuration({
  database: {
    default: {
      master: {
        driver: MysqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mysql",
        host: "mariadb",
        username: "username",
        password: "password",
        database: "database"
      }
    }
  }
})
