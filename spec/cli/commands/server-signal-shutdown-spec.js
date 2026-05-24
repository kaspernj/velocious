// @ts-check

import {EventEmitter} from "node:events"
import {describe, expect, it} from "../../../src/testing/test.js"
import {waitForApplicationWithSignalShutdown} from "../../../src/environment-handlers/node/cli/commands/server.js"

/** Fake application for signal-shutdown command tests. */
class FakeApplication {
  stopCalls = 0

  /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
  waitResolve

  /** @type {Promise<void> | undefined} */
  stopDelay

  /** @type {Error | undefined} */
  stopError

  /** @returns {Promise<void>} - Waits until the fake app closes. */
  wait() {
    return new Promise((resolve) => {
      this.waitResolve = resolve
    })
  }

  /** @returns {Promise<void>} - Stops the fake app. */
  async stop() {
    this.stopCalls += 1

    if (this.stopError) throw this.stopError
    if (this.stopDelay) await this.stopDelay

    this.close()
  }

  /** @returns {void} - Closes the fake app. */
  close() {
    if (this.waitResolve) this.waitResolve()
  }
}

/** @returns {Promise<void>} - Waits for queued promises to run. */
function waitForTick() {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

describe("VelociousCliCommandsServer signal shutdown", () => {
  it("stops the application when SIGTERM is received", async () => {
    const application = new FakeApplication()
    const processObject = new EventEmitter()
    const waitPromise = waitForApplicationWithSignalShutdown({
      application,
      processObject
    })

    processObject.emit("SIGTERM")
    await waitPromise

    expect(application.stopCalls).toEqual(1)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
  })

  it("does not stop twice when multiple shutdown signals arrive", async () => {
    const application = new FakeApplication()
    const processObject = new EventEmitter()
    /** @type {() => void} */
    let resolveStopDelay = () => {}
    application.stopDelay = new Promise((resolve) => {
      resolveStopDelay = resolve
    })
    const waitPromise = waitForApplicationWithSignalShutdown({
      application,
      processObject
    })

    processObject.emit("SIGTERM")
    processObject.emit("SIGINT")
    await waitForTick()

    expect(application.stopCalls).toEqual(1)

    resolveStopDelay()
    await waitPromise
  })

  it("does not stop the application when it closes naturally", async () => {
    const application = new FakeApplication()
    const processObject = new EventEmitter()
    const waitPromise = waitForApplicationWithSignalShutdown({
      application,
      processObject
    })

    application.close()
    await waitPromise

    expect(application.stopCalls).toEqual(0)
    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
  })

  it("rejects when graceful stop fails", async () => {
    const application = new FakeApplication()
    const processObject = new EventEmitter()
    const expectedError = new Error("stop failed")
    application.stopError = expectedError
    const waitPromise = waitForApplicationWithSignalShutdown({
      application,
      processObject
    })

    processObject.emit("SIGTERM")

    try {
      await waitPromise
      throw new Error("Expected wait to reject")
    } catch (error) {
      expect(error).toEqual(expectedError)
    }

    expect(processObject.listenerCount("SIGTERM")).toEqual(0)
    expect(processObject.listenerCount("SIGINT")).toEqual(0)
  })
})
