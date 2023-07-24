import Cli from "../../../../src/cli/index.mjs"

describe("Cli - Commands - db:create", () => {
  fit("generates a new migration", async () => {
    const cli = new Cli()
    const result = await cli.execute({processArgs: ["db:create"], testing: true})

    expect(result.migrationName).toEqual("create-tasks")
    expect(result.migrationNameCamelized).toEqual("CreateTasks")
    expect(result.migrationNumber).toMatch(/^\d+$/)
    expect(result.migrationPath).toMatch(/-create-tasks\.mjs$/)
  })
})
