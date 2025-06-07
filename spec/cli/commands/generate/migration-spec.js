import Cli from "../../../../src/cli/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"

describe("Cli - generate - migration", () => {
  it("generates a new migration", async () => {
    const cli = new Cli({
      directory: dummyDirectory(),
      processArgs: ["g:migration", "create-tasks"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.migrationName).toEqual("create-tasks")
    expect(result.migrationNameCamelized).toEqual("CreateTasks")
    expect(result.migrationNumber).toMatch(/^\d+$/)
    expect(result.migrationPath).toMatch(/-create-tasks\.js$/)
  })
})
