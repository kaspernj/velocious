// @ts-check

import SystemTest from "system-testing/build/system-test.js"

import {describe, expect, it} from "../../src/testing/test.js"

describe("useDatabase selection state", () => {
  it("renders a changed tenant selection as unloaded before passive effects run", async () => {
    if (process.env.VELOCIOUS_BROWSER_TESTS !== "true") return

    const result = await SystemTest.current().executeScript(`
      const scenarioRunner = globalThis.velociousBrowserTest?.runUseDatabaseSelectionTransitionScenario

      if (!scenarioRunner) throw new Error("useDatabase browser scenario runner is not installed")

      return await scenarioRunner()
    `)

    expect(result.initialLoaded).toEqual(true)
    expect(result.loadedAfterInlineLoaderRerender).toEqual(true)
    expect(result.firstChangedLoaded).toEqual(false)
    expect(result.loaderCalls).toEqual(["first", "second", "third"])
    expect(result.thirdAfterStaleCompletion).toEqual({error: null, loaded: true})
  })
})
