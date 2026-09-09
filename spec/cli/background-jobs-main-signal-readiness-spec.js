// @ts-check

import {EventEmitter} from "node:events"
import {describe, expect, it} from "../../src/testing/test.js"
import {waitForBackgroundJobsMainShutdown} from "../../src/environment-handlers/node/cli/commands/background-jobs-main.js"

class FakeBackgroundJobsMain {
  stopCalls = 0

  /** @type {(() => void) | undefined} */
  resolveStopped

  /** @type {Promise<void> | undefined} */
  stopDelay

  /** @type {Error | undefined} */
  stopError

  stoppedPromise = new Promise((resolve) => {
    this.resolveStopped = resolve
  })

  /** @returns {Promise<void>} - Stops the fake main. */
  async stop() {
    this.stopCalls += 1
    this.resolveStopped?.()
    if (this.stopDelay) await this.stopDelay
    if (this.stopError) throw this.stopError
  }

  /** @returns {Promise<void>} - Waits until the fake main stops. */
  waitUntilStopped() {
    return this.stoppedPromise
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

  it("propagates an initiated stop rejection after the stopped barrier settles", async () => {
    const main = new FakeBackgroundJobsMain()
    const processObject = new EventEmitter()
    const shutdownError = new Error("background jobs main shutdown failed")
    /** @type {() => void} */
    let releaseStop = () => {}
    main.stopDelay = new Promise((resolve) => {
      releaseStop = () => resolve(undefined)
    })
    main.stopError = shutdownError
    const waitPromise = waitForBackgroundJobsMainShutdown({
      main,
      onReady: () => processObject.emit("SIGTERM"),
      processObject
    })

    await main.waitUntilStopped()
    releaseStop()

    try {
      await waitPromise
      throw new Error("Expected signal shutdown to reject")
    } catch (error) {
      expect(error).toBe(shutdownError)
    }

    expect(main.stopCalls).toEqual(1)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
  })

  it("observes a spontaneous stop without initiating another stop", async () => {
    const main = new FakeBackgroundJobsMain()
    const processObject = new EventEmitter()
    const waitPromise = waitForBackgroundJobsMainShutdown({
      main,
      onReady: () => main.resolveStopped?.(),
      processObject
    })

    await waitPromise

    expect(main.stopCalls).toEqual(0)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
  })
})
