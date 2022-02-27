const {Database: {Drivers: {Mysql}}} = require("../../../../index.cjs")
const {databaseConfiguration} = require("../../../dummy/src/config/database.cjs")
const {digg} = require("diggerize")
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
