// @ts-check

import Cli from "../../../src/cli/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import dummyDirectory from "../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"

describe("Cli - Commands - init", () => {
  it("inits files and dirs", async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["init"],
      testing: true
    })
    const result = await cli.execute()

    expect(result.fileMappings.length).toEqual(2)
    expect(result.fileMappings[0].source).toContain("/src/templates/configuration.js")
    expect(result.fileMappings[0].target).toContain("/spec/dummy/src/config/configuration.js")
    expect(result.fileMappings[1].source).toContain("/src/templates/routes.js")
    expect(result.fileMappings[1].target).toContain("/spec/dummy/src/config/routes.js")
  })
})
