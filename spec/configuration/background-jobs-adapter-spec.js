// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import BackgroundJobsTestAdapter from "../helpers/background-jobs-test-adapter.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Creates a manually resolved promise.
 * @returns {{promise: Promise<void>, resolve: () => void}} - Deferred promise.
 */
function deferred() {
  /** @type {() => void} */
  let resolve = () => {}
  const promise = new Promise((actualResolve) => {
    resolve = actualResolve
  })

  return {promise, resolve}
}

/**
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} backgroundJobs - Background-jobs configuration.
 * @returns {Configuration} - Isolated configuration.
 */
function buildConfiguration(backgroundJobs) {
  return new Configuration({
    backgroundJobs,
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

describe("Background jobs adapter configuration", () => {
  it("defaults to background mode and resolves an adapter instance once", async () => {
    const adapter = new BackgroundJobsTestAdapter()
    const configuration = buildConfiguration({adapter})

    expect(configuration.getBackgroundJobsConfig().mode).toEqual("background")
    expect(configuration.getBackgroundJobsAdapter()).toEqual(adapter)
    expect(configuration.getBackgroundJobsAdapter()).toEqual(adapter)

    await configuration.ensureBackgroundJobsAdapterReady()
    await configuration.ensureBackgroundJobsAdapterReady()

    expect(adapter.readyCount).toEqual(1)
  })

  it("creates one factory adapter per lifecycle and closes it once", async () => {
    const adapters = []
    const configuration = buildConfiguration({
      adapter: () => {
        const adapter = new BackgroundJobsTestAdapter()
        adapters.push(adapter)
        return adapter
      }
    })

    const first = configuration.getBackgroundJobsAdapter()
    expect(configuration.getBackgroundJobsAdapter()).toEqual(first)

    await configuration.ensureBackgroundJobsAdapterReady()
    await configuration.closeDatabaseConnections()
    await configuration.closeBackgroundJobsAdapter()

    expect(adapters.length).toEqual(1)
    expect(adapters[0].closeCount).toEqual(1)
    expect(configuration.getBackgroundJobsAdapter()).not.toEqual(first)
    expect(adapters.length).toEqual(2)
  })

  it("rejects invalid modes and adapter factories", () => {
    expect(() => buildConfiguration(/** @type {ReturnType<typeof JSON.parse>} */ ({mode: "worker"})).getBackgroundJobsConfig()).toThrow(/backgroundJobs.mode/)
    expect(() => buildConfiguration(/** @type {ReturnType<typeof JSON.parse>} */ ({adapter: () => ({})})).getBackgroundJobsAdapter()).toThrow(/BackgroundJobsAdapter/)
  })

  it("does not return a replaced adapter before that exact generation is ready", async () => {
    const firstReady = deferred()
    const adapters = []
    const configuration = buildConfiguration({
      adapter: () => {
        const adapter = new BackgroundJobsTestAdapter({
          ready: adapters.length === 0 ? async () => await firstReady.promise : undefined
        })
        adapters.push(adapter)
        return adapter
      }
    })

    const acquirePromise = configuration.acquireReadyBackgroundJobsAdapter()

    expect(adapters.length).toEqual(1)
    const closePromise = configuration.closeBackgroundJobsAdapter()

    firstReady.resolve()
    await closePromise

    const acquiredAdapter = await acquirePromise

    expect(adapters.length).toEqual(2)
    expect(adapters[0].closeCount).toEqual(1)
    expect(adapters[1].readyCount).toEqual(1)
    expect(acquiredAdapter).toEqual(adapters[1])
  })
})
