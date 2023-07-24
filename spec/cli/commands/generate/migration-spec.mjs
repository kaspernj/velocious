import Cli from "../../../../src/cli/index.mjs"

describe("Cli - generate - migration", () => {
  it("generates a new migration", async () => {
    const cli = new Cli()
    const result = await cli.execute({processArgs: ["g:migration", "create-tasks"], testing: true})

    expect(result.migrationName).toEqual("create-tasks")
    expect(result.migrationNameCamelized).toEqual("CreateTasks")
    expect(result.migrationNumber).toMatch(/^\d+$/)
    expect(result.migrationPath).toMatch(/-create-tasks\.mjs$/)
  })
})
