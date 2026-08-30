// @ts-check

import { EventEmitter } from "node:events"

import { waitForBackgroundJobsWorkerShutdown } from "../../src/environment-handlers/node/cli/commands/background-jobs-worker.js"
import { describe, expect, it } from "../../src/testing/test.js"

class FakeBackgroundJobsWorker {
  stopCalls = 0

  /** @type {(() => void) | undefined} */
  resolveStopped

  stoppedPromise = new Promise((resolve) => { this.resolveStopped = resolve })

  /** @returns {Promise<void>} - Stops the fake worker. */
  async stop() {
    this.stopCalls += 1
    this.resolveStopped?.()
  }

  /** @returns {Promise<void>} - Resolves when stopped. */
  waitUntilStopped() { return this.stoppedPromise }
}

describe("Background jobs worker CLI signal readiness", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("owns shutdown signals before announcing readiness", async () => {
    const worker = new FakeBackgroundJobsWorker()
    const processObject = new EventEmitter()
    let sigintListenersAtReady = 0
    let sigtermListenersAtReady = 0
    const waitPromise = waitForBackgroundJobsWorkerShutdown({
      onReady: () => {
        sigintListenersAtReady = processObject.listenerCount("SIGINT")
        sigtermListenersAtReady = processObject.listenerCount("SIGTERM")
        processObject.emit("SIGTERM")
        processObject.emit("SIGINT")
      },
      processObject,
      worker
    })

    await waitPromise

    expect(sigintListenersAtReady).toEqual(1)
    expect(sigtermListenersAtReady).toEqual(1)
    expect(worker.stopCalls).toEqual(1)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
  })
})
