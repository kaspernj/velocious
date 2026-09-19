// @ts-check

import SystemTest from "system-testing/build/system-test.js"
import { describe, expect, it } from "@velocious/testing"

describe("frontend tenant browser persistence", {databaseCleaning: {transaction: false, truncate: false}, tags: ["browser-only"]}, () => {
  it("keeps repeated concurrent project work isolated across a real SQL.js close and reopen", async () => {
    const result = await SystemTest.current().executeScript(`
      const scenarioRunner = globalThis.velociousBrowserTest?.runFrontendTenantDatabasePersistenceScenario

      if (!scenarioRunner) throw new Error("Frontend tenant database browser scenario runner is not installed")

      return await scenarioRunner()
    `)

    expect(result.identitiesAreDistinct).toEqual(true)
    expect(result.alphaNames).toEqual(Array.from({length: 12}, (_value, index) => `alpha-${index}`))
    expect(result.betaNames).toEqual(Array.from({length: 12}, (_value, index) => `beta-${index}`))
    expect(result.openCount).toEqual(2)
  })
})
