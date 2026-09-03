// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import BackgroundJobsTestAdapter from "../helpers/background-jobs-test-adapter.js"
import promiseBarrier from "../helpers/promise-barrier.js"
import {describe, expect, it} from "../../src/testing/test.js"

class StartupAdapter extends BackgroundJobsTestAdapter {
  /**
   * @param {{ready?: () => Promise<void>, reconcile?: () => Promise<void>}} [args] - Adapter hooks.
   */
  constructor({ready, reconcile} = {}) {
    super({ready})
    this.reconcile = reconcile
    this.reconcileCount = 0
  }

  /** @returns {boolean} - Supports release-scoped lifecycle tests. */
  supportsReleaseScopedGenerations() { return true }

  /** @returns {Promise<void>} - Resolves after reconciliation. */
  async reconcileQueueConcurrency() {
    this.reconcileCount++
    await this.reconcile?.()
  }

  /** @returns {Promise<null>} - No scheduled work. */
  async nextScheduledJob() {
    return null
  }
}

class MainWithAssignedStore extends BackgroundJobsMain {
  /**
   * @param {ConstructorParameters<typeof BackgroundJobsMain>[0] & {store: StartupAdapter}} args - Main and store options.
   */
  constructor({store, ...args}) {
    super(args)
    this.store = store
  }
}

/**
 * @param {() => StartupAdapter} adapterFactory - Adapter factory.
 * @returns {Configuration} - Isolated main configuration.
 */
function buildConfiguration(adapterFactory) {
  return new Configuration({
    backgroundJobs: {
      adapter: adapterFactory,
      retention: {completedTtlMs: null, failedTtlMs: null}
    },
    beacon: {inProcess: true},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

/**
 * @param {Configuration} configuration - Main configuration.
 * @returns {BackgroundJobsMain} - Main configured for isolated lifecycle tests.
 */
function buildMain(configuration) {
  return new BackgroundJobsMain({
    closeDatabaseConnectionsOnStop: false,
    configuration,
    host: "127.0.0.1",
    port: 0
  })
}

describe("Background jobs - main startup adapter lifecycle", () => {
  it("fences an in-flight candidate activation before reconciliation can enable ownership", async () => {
    const reconciliation = promiseBarrier()
    const adapter = new StartupAdapter({
      reconcile: async () => {
        reconciliation.entered()
        await reconciliation.blocked
      }
    })
    const configuration = buildConfiguration(() => adapter)
    const main = new MainWithAssignedStore({
      closeDatabaseConnectionsOnStop: false,
      configuration,
      generationId: "release-candidate",
      host: "127.0.0.1",
      initialGenerationState: "candidate",
      port: 0,
      store: adapter
    })
    let activation

    try {
      await main.start()
      activation = main.activate()
      await reconciliation.waiting

      await main.retire()
      expect(main.getLifecycleState()).toEqual("retiring")
      expect(main._activeOwnershipReady).toEqual(false)

      reconciliation.release()
      await expect(async () => await activation).toThrow("Background jobs generation retirement started before activation acquired ownership")
      await main._retirementPromise

      expect(main.getLifecycleState()).toEqual("retired")
      expect(main.scheduler).toBeUndefined()
      expect(main._activeOwnershipReady).toEqual(false)
      expect(main.readyWorkers.size).toEqual(0)
    } finally {
      reconciliation.release()
      await Promise.allSettled([activation, main._retirementPromise].filter(Boolean))
      await main.stop()
      await configuration.closeBackgroundJobsAdapter()
    }
  })

  it("preserves a store assigned by a subclass before start", async () => {
    const assignedStore = new StartupAdapter()
    let configuredAdapterCount = 0
    const configuration = buildConfiguration(() => {
      configuredAdapterCount++
      return new StartupAdapter()
    })
    const main = new MainWithAssignedStore({
      closeDatabaseConnectionsOnStop: false,
      configuration,
      host: "127.0.0.1",
      port: 0,
      store: assignedStore
    })

    try {
      await main.start()

      expect(main.store).toEqual(assignedStore)
      expect(assignedStore.reconcileCount).toEqual(1)
      expect(configuredAdapterCount).toEqual(0)
    } finally {
      await main.stop()
      await configuration.closeBackgroundJobsAdapter()
    }
  })

  it("cleans a failed readiness generation and Beacon before retrying", async () => {
    const adapters = []
    const configuration = buildConfiguration(() => {
      const adapter = new StartupAdapter({
        ready: adapters.length === 0 ? async () => { throw new Error("startup readiness failed") } : undefined
      })
      adapters.push(adapter)
      return adapter
    })
    const main = buildMain(configuration)

    try {
      await expect(async () => await main.start()).toThrow(/startup readiness failed/)

      expect(configuration.getBeaconClient()).toBeUndefined()
      expect(main.adapter).toBeUndefined()
      expect(main.server).toBeUndefined()
      expect(adapters[0].closeCount).toEqual(1)

      await main.start()

      expect(adapters.length).toEqual(2)
      expect(main.adapter).toEqual(adapters[1])
      expect(adapters[1].readyCount).toEqual(1)
      expect(adapters[1].reconcileCount).toEqual(1)
    } finally {
      await main.stop()
      await configuration.closeBackgroundJobsAdapter()
    }
  })

  it("cleans a failed reconcile generation and Beacon before retrying", async () => {
    const adapters = []
    const configuration = buildConfiguration(() => {
      const adapter = new StartupAdapter({
        reconcile: adapters.length === 0 ? async () => { throw new Error("startup reconcile failed") } : undefined
      })
      adapters.push(adapter)
      return adapter
    })
    const main = buildMain(configuration)

    try {
      await expect(async () => await main.start()).toThrow(/startup reconcile failed/)

      expect(configuration.getBeaconClient()).toBeUndefined()
      expect(main.adapter).toBeUndefined()
      expect(main.server).toBeUndefined()
      expect(adapters[0].closeCount).toEqual(1)

      await main.start()

      expect(adapters.length).toEqual(2)
      expect(main.adapter).toEqual(adapters[1])
      expect(adapters[1].readyCount).toEqual(1)
      expect(adapters[1].reconcileCount).toEqual(1)
    } finally {
      await main.stop()
      await configuration.closeBackgroundJobsAdapter()
    }
  })
})
