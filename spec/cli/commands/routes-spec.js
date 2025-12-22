// @ts-check

import Cli from "../../../src/cli/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import dummyDirectory from "../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"

describe("Cli - Commands - routes", () => {
  it("outputs routes to the user", async () => {
    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["routes"],
      testing: true
    })
    const {output} = await cli.execute()

    expect(output).toContain("api\n")
  })
})
