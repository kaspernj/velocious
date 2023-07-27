import Cli from "../../../../src/cli/index.mjs"
import dummyDirectory from "../../../dummy/dummy-directory.mjs"

describe("Cli - Commands - db:create", () => {
  it("generates SQL to create a new database", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["db:create"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.databaseName).toEqual("velocious_test")
    expect(result.sql).toEqual("CREATE DATABASE IF NOT EXISTS velocious_test")
  })
})
