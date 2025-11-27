import Cli from "../../../../src/cli/index.js"
import commandsFinderNode from "../../../../src/cli/commands-finder-node.js"
import commandsRequireNode from "../../../../src/cli/commands-require-node.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"

describe("Cli - generate - migration", () => {
  it("generates a new migration", async () => {
    const cli = new Cli({
      commands: await commandsFinderNode(),
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      processArgs: ["g:migration", "create-tasks"],
      requireCommand: commandsRequireNode,
      testing: true
    })
    const result = await cli.execute()

    expect(result.migrationName).toEqual("create-tasks")
    expect(result.migrationNameCamelized).toEqual("CreateTasks")
    expect(result.migrationNumber).toMatch(/^\d+$/)
    expect(result.migrationPath).toMatch(/-create-tasks\.js$/)
  })
})
