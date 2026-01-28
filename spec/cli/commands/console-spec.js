// @ts-check

import Cli from "../../../src/cli/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import dummyDirectory from "../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"

describe("Cli - Commands - console", () => {
  it("loads the console via the alias", async () => {
    const originalEnvironment = dummyConfiguration.getEnvironment()

    dummyConfiguration.setEnvironment("test")

    const cli = new Cli({
      configuration: dummyConfiguration,
      directory: dummyDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["c"],
      testing: true
    })
    try {
      const result = await cli.execute()

      expect(result.modelNames).toContain("User")
    } finally {
      dummyConfiguration.setEnvironment(originalEnvironment)
    }
  })
})
