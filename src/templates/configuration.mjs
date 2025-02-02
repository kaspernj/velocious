import AsyncTrackedMultiConnection from "velocious/src/database/pool/async-tracked-multi-connection.mjs"
import Configuration from "velocious/src/configuration.mjs"
import MysqlDriver from "velocious/src/database/drivers/mysql/index.mjs"

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
