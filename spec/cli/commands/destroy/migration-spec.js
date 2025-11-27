import Cli from "../../../../src/cli/index.js"
import dummyConfiguration from "../../../dummy/src/config/configuration.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"

describe("Cli - destroy - migration", () => {
  it("destroys an existing migration", async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["d:migration", "create-tasks"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.destroyed).toEqual(["create-tasks"])
  })
})
