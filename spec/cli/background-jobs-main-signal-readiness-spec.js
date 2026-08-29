// @ts-check

import {EventEmitter} from "node:events"
import {describe, expect, it} from "../../src/testing/test.js"
import {waitForBackgroundJobsMainShutdown} from "../../src/environment-handlers/node/cli/commands/background-jobs-main.js"

class FakeBackgroundJobsMain {
  stopCalls = 0

  /** @type {(() => void) | undefined} */
  resolveStopped

  /** @returns {Promise<void>} - Stops the fake main. */
  async stop() {
    this.stopCalls += 1
    this.resolveStopped?.()
  }

  /** @returns {Promise<void>} - Waits until the fake main stops. */
  waitUntilStopped() {
    return new Promise((resolve) => {
      this.resolveStopped = resolve
    })
  }
}

describe("Background jobs main CLI signal readiness", () => {
  it("owns shutdown signals before announcing readiness", async () => {
    const main = new FakeBackgroundJobsMain()
    const processObject = new EventEmitter()
    let sigintListenersAtReady = 0
    let sigtermListenersAtReady = 0
    const waitPromise = waitForBackgroundJobsMainShutdown({
      main,
      onReady: () => {
        sigintListenersAtReady = processObject.listenerCount("SIGINT")
        sigtermListenersAtReady = processObject.listenerCount("SIGTERM")
        processObject.emit("SIGTERM")
        processObject.emit("SIGINT")
      },
      processObject
    })

    await waitPromise

    expect(sigintListenersAtReady).toEqual(1)
    expect(sigtermListenersAtReady).toEqual(1)
    expect(main.stopCalls).toEqual(1)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
  })
})
