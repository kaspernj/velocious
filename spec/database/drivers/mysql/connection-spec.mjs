import DatabaseDriversMysql from "../../../../src/database/drivers/mysql/index.mjs"
import configuration from "../../../dummy/src/config/configuration.mjs"
import {digg} from "diggerize"

const mysqlConfig = digg(configuration, "database", "default", "master")

describe("Database - Drivers - Mysql - Connection", () => {
  it("connects", async () => {
    const mysql = new DatabaseDriversMysql(mysqlConfig)

    await mysql.connect()

    const result = await mysql.query("SELECT \"1\" AS test1, \"2\" AS test2")

    expect(result).toEqual([{
      test1: "1",
      test2: "2"
    }])
  })
})
