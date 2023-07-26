import Cli from "../../../../src/cli/index.mjs"

describe("Cli - Commands - db:create", () => {
  it("generates a new migration", async () => {
    const cli = new Cli()
    const result = await cli.execute({processArgs: ["db:create"], testing: true})

    expect(result.databaseName).toEqual("velocious_test")
    expect(result.sql).toEqual("CREATE DATABASE IF NOT EXISTS development")
  })
})
