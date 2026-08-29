// @ts-check

import Configuration from "../../src/configuration.js"
import LocalBackgroundJobsDispatcher from "../../src/background-jobs/local-dispatcher.js"
import LocalBackgroundJobRegistry from "../../src/background-jobs/local-job-registry.js"
import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {deferred} from "awaitery"
import {ManualBackgroundJobsClock} from "../helpers/local-background-jobs-test-harness.js"

class ContextTrackingConfiguration extends Configuration {
  connectionContextActive = true
  testDatabaseAccessScopeActive = true

  constructor() {
    super({
      backgroundJobs: {
        jobClasses: [],
        maxConcurrentInlineJobs: 1,
        mode: "inline",
        queues: {}
      },
      database: {test: {}},
      environmentHandler: new NodeEnvironmentHandler()
    })
  }

  async initialize() {}

  setCurrent() {}

  withoutCurrentConnectionContexts(callback) {
    const previous = this.connectionContextActive

    this.connectionContextActive = false
    const result = callback()

    if (result instanceof Promise) {
      return result.finally(() => { this.connectionContextActive = previous })
    }

    this.connectionContextActive = previous
    return result
  }

  withoutCurrentTestDatabaseAccessScope(callback) {
    const previous = this.testDatabaseAccessScopeActive

    this.testDatabaseAccessScopeActive = false
    const result = callback()

    if (result instanceof Promise) {
      return result.finally(() => { this.testDatabaseAccessScopeActive = previous })
    }

    this.testDatabaseAccessScopeActive = previous
    return result
  }
}

class ContextTrackingStore extends LocalBackgroundJobsStore {
  /** @type {Array<{connection: boolean, testDatabaseAccessScope: boolean}>} */
  observedConnectionContexts = []

  async ensureReady() {}

  async reconcileQueueConcurrency() {}

  async recoverHandedOffJobs() { return [] }

  async nextAvailableJob() {
    const configuration = /** @type {ContextTrackingConfiguration} */ (this.configuration)

    this.observedConnectionContexts.push({
      connection: configuration.connectionContextActive,
      testDatabaseAccessScope: configuration.testDatabaseAccessScopeActive
    })
    return null
  }

  async nextScheduledJob() {
    const configuration = /** @type {ContextTrackingConfiguration} */ (this.configuration)

    this.observedConnectionContexts.push({
      connection: configuration.connectionContextActive,
      testDatabaseAccessScope: configuration.testDatabaseAccessScopeActive
    })
    return null
  }
}

class FailingContextTrackingStore extends ContextTrackingStore {
  failureGate = deferred()

  async nextAvailableJob() {
    await this.failureGate.promise
    throw new Error("Planned detached drain failure")
  }
}

describe("Local background jobs dispatcher - database contexts", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("runs detached drain work outside the caller's database contexts", async () => {
    const configuration = new ContextTrackingConfiguration()
    const registry = new LocalBackgroundJobRegistry({jobClasses: []})
    const store = new ContextTrackingStore({configuration})
    const dispatcher = new LocalBackgroundJobsDispatcher({clock: store.clock, configuration, registry, store})

    await dispatcher.start()

    try {
      await dispatcher.waitForIdle()
      expect(store.observedConnectionContexts).toEqual([
        {connection: false, testDatabaseAccessScope: false},
        {connection: false, testDatabaseAccessScope: false}
      ])
    } finally {
      await dispatcher.stop()
    }
  })

  it("keeps drain failure reporting and recovery outside the caller's database contexts", async () => {
    const configuration = new ContextTrackingConfiguration()
    const registry = new LocalBackgroundJobRegistry({jobClasses: []})
    const store = new FailingContextTrackingStore({configuration})
    const clock = new ManualBackgroundJobsClock()
    const dispatcher = new LocalBackgroundJobsDispatcher({clock, configuration, registry, store})
    /** @type {Array<{connection: boolean, testDatabaseAccessScope: boolean}>} */
    const observedFailureContexts = []
    const onFrameworkError = () => {
      observedFailureContexts.push({
        connection: configuration.connectionContextActive,
        testDatabaseAccessScope: configuration.testDatabaseAccessScopeActive
      })
      throw new Error("Planned framework-error listener failure")
    }

    configuration.getErrorEvents().on("framework-error", onFrameworkError)

    try {
      await dispatcher.start()
      const drainPromise = dispatcher._drainPromise

      store.failureGate.resolve(undefined)
      await expect(async () => await drainPromise).toThrow("Planned framework-error listener failure")

      expect(observedFailureContexts).toEqual([{connection: false, testDatabaseAccessScope: false}])
      expect(clock.timers.size).toEqual(1)
    } finally {
      configuration.getErrorEvents().off("framework-error", onFrameworkError)
      await dispatcher.stop()
    }
  })
})
