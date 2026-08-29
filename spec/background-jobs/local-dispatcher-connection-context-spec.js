// @ts-check

import Configuration from "../../src/configuration.js"
import LocalBackgroundJobsDispatcher from "../../src/background-jobs/local-dispatcher.js"
import LocalBackgroundJobRegistry from "../../src/background-jobs/local-job-registry.js"
import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

class ContextTrackingConfiguration extends Configuration {
  connectionContextActive = true

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
}

class ContextTrackingStore extends LocalBackgroundJobsStore {
  /** @type {boolean[]} */
  observedConnectionContexts = []

  async ensureReady() {}

  async reconcileQueueConcurrency() {}

  async recoverHandedOffJobs() { return [] }

  async nextAvailableJob() {
    this.observedConnectionContexts.push(/** @type {ContextTrackingConfiguration} */ (this.configuration).connectionContextActive)
    return null
  }

  async nextScheduledJob() {
    this.observedConnectionContexts.push(/** @type {ContextTrackingConfiguration} */ (this.configuration).connectionContextActive)
    return null
  }
}

describe("Local background jobs dispatcher - connection context", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("runs detached drain work outside the caller's database connection context", async () => {
    const configuration = new ContextTrackingConfiguration()
    const registry = new LocalBackgroundJobRegistry({jobClasses: []})
    const store = new ContextTrackingStore({configuration})
    const dispatcher = new LocalBackgroundJobsDispatcher({clock: store.clock, configuration, registry, store})

    await dispatcher.start()

    try {
      await dispatcher.waitForIdle()
      expect(store.observedConnectionContexts).toEqual([false, false])
    } finally {
      await dispatcher.stop()
    }
  })
})
