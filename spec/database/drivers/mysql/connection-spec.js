import DatabaseDriversMysql from "../../../../src/database/drivers/mysql/index.js"
import configuration from "../../../dummy/src/config/configuration.js"
import {digg} from "diggerize"

const mysqlConfig = digg(configuration, "database", "test", "default")

describe("Database - Drivers - Mysql - Connection", () => {
  it("connects", async () => {
    if (configuration.getDatabaseType() != "sqlite" && configuration.getDatabaseType() != "mssql" && configuration.getDatabaseType() != "pgsql") {
      const mysql = new DatabaseDriversMysql(mysqlConfig, configuration)

      await mysql.connect()

      const result = await mysql.query("SELECT \"1\" AS test1, \"2\" AS test2")

      expect(result).toEqual([{
        test1: "1",
        test2: "2"
      }])
    }
  })
})
