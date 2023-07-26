import Cli from "../../../../src/cli/index.mjs"
import configuration from "../../../dummy/src/config/configuration.mjs"

configuration.setCurrent()

describe("Cli - Commands - db:create", () => {
  it("generates a new migration", async () => {

    const cli = new Cli()
    const result = await cli.execute({processArgs: ["db:create"], testing: true})

    expect(result.databaseName).toEqual("development")
    expect(result.sql).toEqual("CREATE DATABASE IF NOT EXISTS development")
  })
})
