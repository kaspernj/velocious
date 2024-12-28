import Configuration from "../../../../src/configuration.mjs"
import dummyDirectory from "../../dummy-directory.mjs"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.mjs"

export default new Configuration({
  database: {
    default: {
      master: {
        driver: MysqlDriver,
        type: "mysql",
        host: "mariadb",
        username: "peakflow",
        password: "password",
        database: "velocious_test",
        useDatabase: "velocious_test"
      }
    }
  },
  directory: dummyDirectory()
})
