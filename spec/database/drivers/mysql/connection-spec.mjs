// import {Database: {Drivers: {Mysql}}} from "../../../../index.mjs"
import {databaseConfiguration} from "../../../dummy/src/config/database.mjs"
import {digg} from "diggerize"
const mysqlConfig = digg(databaseConfiguration(), "default", "master")

describe("Database - Drivers - Mysql - Connection", () => {
  it("connects", async () => {
    const mysql = new Mysql(mysqlConfig)

    await mysql.connect()

    const result = await mysql.query("SELECT \"1\" AS test1, \"2\" AS test2")

    expect(result).toEqual({
      test1: "1",
      test2: "2"
    })
  })
})
