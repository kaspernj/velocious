// @ts-check

import SystemTest from "system-testing/build/system-test.js"

import {describe, expect, it} from "../../src/testing/test.js"

/** @typedef {"classLifecycle" | "debounceUnmount" | "instanceLifecycle" | "resubscribeInstance"} FrontendModelEventHookScenario */

/** @returns {boolean} - Whether the browser test runner is active. */
function runBrowserHookScenarios() {
  return process.env.VELOCIOUS_BROWSER_TESTS === "true"
}

/**
 * @param {FrontendModelEventHookScenario} scenarioName - Browser scenario name.
 * @returns {Promise<Record<string, number> | null>} - Scenario result, or null outside the browser runner.
 */
async function runFrontendModelEventHookScenario(scenarioName) {
  if (!runBrowserHookScenarios()) return null

  return /** @type {Promise<Record<string, number>>} */ (SystemTest.current().executeScript(`
    const scenarioRunner = globalThis.velociousBrowserTest?.runFrontendModelEventHookScenario

    if (!scenarioRunner) {
      throw new Error("Frontend model event hook browser scenario runner is not installed")
    }

    return await scenarioRunner(arguments[0])
  `, scenarioName))
}

describe("Frontend model event hooks", () => {
  it("subscribes to class lifecycle events and unsubscribes on unmount", async () => {
    const result = await runFrontendModelEventHookScenario("classLifecycle")
    if (!result) return

    expect(result.mountedCreateSubscriptions).toEqual(2)
    expect(result.mountedUpdateSubscriptions).toEqual(1)
    expect(result.mountedDestroySubscriptions).toEqual(0)
    expect(result.mountedConnectedCount).toEqual(1)
    expect(result.receivedEventsAfterEmit).toEqual(3)
    expect(result.unmountedCreateSubscriptions).toEqual(0)
    expect(result.unmountedUpdateSubscriptions).toEqual(0)
  })

  it("subscribes to instance update and destroy events", async () => {
    const result = await runFrontendModelEventHookScenario("instanceLifecycle")
    if (!result) return

    expect(result.mountedUpdateSubscriptions).toEqual(1)
    expect(result.mountedDestroySubscriptions).toEqual(1)
    expect(result.mountedConnectedCount).toEqual(2)
    expect(result.receivedEventsAfterEmit).toEqual(2)
    expect(result.unmountedUpdateSubscriptions).toEqual(0)
    expect(result.unmountedDestroySubscriptions).toEqual(0)
  })

  it("clears pending debounced callbacks on unmount", async () => {
    const result = await runFrontendModelEventHookScenario("debounceUnmount")
    if (!result) return

    expect(result.receivedEventsAfterDebounceWindow).toEqual(0)
  })

  it("resubscribes instance hooks when the model object changes", async () => {
    const result = await runFrontendModelEventHookScenario("resubscribeInstance")
    if (!result) return

    expect(result.firstMountedUpdateSubscriptions).toEqual(1)
    expect(result.firstMountedDestroySubscriptions).toEqual(1)
    expect(result.firstAfterRerenderUpdateSubscriptions).toEqual(0)
    expect(result.firstAfterRerenderDestroySubscriptions).toEqual(0)
    expect(result.secondAfterRerenderUpdateSubscriptions).toEqual(1)
    expect(result.secondAfterRerenderDestroySubscriptions).toEqual(1)
    expect(result.receivedEventsAfterEmit).toEqual(2)
  })
})
