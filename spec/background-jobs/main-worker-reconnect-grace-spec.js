// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

const MAX_TIMER_MS = 2_147_483_647

/** @param {number} workerReconnectGraceMs - Reconnect grace. @returns {BackgroundJobsMain} - Unstarted main. */
function createMain(workerReconnectGraceMs) {
  return new BackgroundJobsMain({
    configuration: dummyConfiguration,
    host: "127.0.0.1",
    port: 0,
    workerReconnectGraceMs
  })
}

describe("Background jobs - main worker reconnect grace", () => {
  it("accepts the exact Node maximum timer delay", () => {
    expect(createMain(MAX_TIMER_MS).workerReconnectGraceMs).toEqual(MAX_TIMER_MS)
  })

  it("rejects a reconnect grace above the Node maximum timer delay", async () => {
    await expect(() => createMain(MAX_TIMER_MS + 1)).toThrow(`workerReconnectGraceMs must be an integer between 0 and ${MAX_TIMER_MS}`)
  })
})
