// @ts-check

import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("EnvironmentHandlerNode testing config", () => {
  it("does not require a testing config path", async () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    environmentHandler.setConfiguration(configuration)

    await environmentHandler.importTestingConfigPath()

    expect(true).toBe(true)
  })
  it("keeps UTC offset zero when nesting runWithAbility", async () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    environmentHandler.setConfiguration(configuration)

    await environmentHandler.runWithTimezoneOffset(0, async () => {
      await environmentHandler.runWithAbility(undefined, async () => {
        expect(environmentHandler.getTimezoneOffsetMinutes(configuration)).toEqual(0)
      })
    })
  })

})
