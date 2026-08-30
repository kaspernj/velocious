// @ts-check

import { EventEmitter } from "node:events"

import { waitForBackgroundJobsWorkerShutdown } from "../../src/environment-handlers/node/cli/commands/background-jobs-worker.js"
import { describe, expect, it } from "../../src/testing/test.js"

class FakeBackgroundJobsWorker {
  startCalls = 0
  stopCalls = 0

  /** @type {(() => void) | undefined} */
  resolveStopped

  stoppedPromise = new Promise((resolve) => { this.resolveStopped = resolve })

  /** @param {() => void} onProtocolReady - Observes protocol readiness during start. */
  constructor(onProtocolReady) {
    this.onProtocolReady = onProtocolReady
  }

  /** @returns {Promise<void>} - Starts the fake worker. */
  async start() {
    this.startCalls += 1
    this.onProtocolReady()
  }

  /** @returns {Promise<void>} - Stops the fake worker. */
  async stop() {
    this.stopCalls += 1
    this.resolveStopped?.()
  }

  /** @returns {Promise<void>} - Resolves when stopped. */
  waitUntilStopped() { return this.stoppedPromise }
}

describe("Background jobs worker CLI signal readiness", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("owns shutdown signals before protocol and CLI readiness", async () => {
    const processObject = new EventEmitter()
    let sigintListenersAtProtocolReady = 0
    let sigtermListenersAtProtocolReady = 0
    let sigintListenersAtReady = 0
    let sigtermListenersAtReady = 0
    const worker = new FakeBackgroundJobsWorker(() => {
      sigintListenersAtProtocolReady = processObject.listenerCount("SIGINT")
      sigtermListenersAtProtocolReady = processObject.listenerCount("SIGTERM")
    })
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

    expect(worker.startCalls).toEqual(1)
    expect(sigintListenersAtProtocolReady).toEqual(1)
    expect(sigtermListenersAtProtocolReady).toEqual(1)
    expect(sigintListenersAtReady).toEqual(1)
    expect(sigtermListenersAtReady).toEqual(1)
    expect(worker.stopCalls).toEqual(1)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
  })
})
