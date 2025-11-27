import Cli from "../../../../src/cli/index.js"
import commandsFinderNode from "../../../../src/cli/commands-finder-node.js"
import commandsRequireNode from "../../../../src/cli/commands-require-node.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"

describe("Cli - destroy - migration", () => {
  it("destroys an existing migration", async () => {
    const cli = new Cli({
      commands: await commandsFinderNode(),
      configuration: dummyConfiguration,
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      processArgs: ["d:migration", "create-tasks"],
      requireCommand: commandsRequireNode,
      testing: true
    })
    const result = await cli.execute()

    expect(result.destroyed).toEqual(["create-tasks"])
  })
})
