// @ts-check

import http from "http"
import wait from "awaitery/build/wait.js"
import {TimeoutError} from "awaitery/build/timeout.js"

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import runWithTransportDeadline from "../../src/frontend-models/transport-deadline.js"
import {resetFrontendModelTransport} from "../helpers/frontend-model-test-helpers.js"
import {listenOnLocalhost} from "../helpers/local-server-helper.js"

/**
 * @typedef {object} ControlledServer
 * @property {() => Promise<void>} close - Stops the server.
 * @property {number} port - Bound TCP port.
 * @property {{requestReceived: boolean, socketClosed: boolean}} state - Observed connection state.
 */

/**
 * Starts a controlled HTTP server whose response behavior is fully driven by the
 * given handler, and records whether a request arrived and whether the client
 * socket was later closed (so timeouts can be asserted to close the live socket).
 * @param {(req: import("http").IncomingMessage, res: import("http").ServerResponse) => void} handler - Request handler.
 * @returns {Promise<ControlledServer>} - The started controlled server.
 */
async function startControlledServer(handler) {
  const state = {requestReceived: false, socketClosed: false}
  const server = http.createServer((req, res) => {
    state.requestReceived = true
    handler(req, res)
  })

  server.on("connection", (socket) => {
    socket.on("close", () => {
      state.socketClosed = true
    })
  })

  const port = await listenOnLocalhost(server)

  return {
    close: () => new Promise((resolve) => {
      // Destroy any lingering (kept-alive or stalled) sockets so close resolves promptly.
      server.closeAllConnections()
      server.close(() => resolve(undefined))
    }),
    port,
    state
  }
}

/**
 * Polls until the condition holds or the timeout elapses.
 * @param {() => boolean} conditionFn - Condition to await.
 * @param {{timeoutMs?: number}} [options] - Poll options.
 * @returns {Promise<void>} - Resolves once the condition holds.
 */
async function waitForCondition(conditionFn, {timeoutMs = 1000} = {}) {
  const start = Date.now()

  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Condition was not met within the allotted time")
    }

    await wait(5)
  }
}

/**
 * Builds a POST fetch operation for the deadline utility that reads the full
 * response body, so both header-wait and body-consumption are under the deadline.
 * @param {string} url - Target URL.
 * @returns {(signal: AbortSignal) => Promise<{status: number, text: string}>} - Deadline operation.
 */
function postOperation(url) {
  return async (signal) => {
    const response = await fetch(url, {body: "{}", headers: {"Content-Type": "application/json"}, method: "POST", signal})
    const text = await response.text()

    return {status: response.status, text}
  }
}

/**
 * @param {string} modelName - Registered model name.
 * @returns {typeof FrontendModelBase} - Shared-API frontend model test class.
 */
function buildSharedApiTestModelClass(modelName) {
  /** Shared API frontend model for deadline specs. */
  class SharedApiModel extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], modelName: string, primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "name"], commands: ["index"], modelName, primaryKey: "id"}
    }
  }

  return SharedApiModel
}

describe("frontend-models - transport deadline", () => {
  describe("runWithTransportDeadline against a controlled server", () => {
    it("aborts a request whose response headers never arrive and reports the socket closure", async () => {
      const controlled = await startControlledServer(() => {
        // Accept the connection but never send response headers.
      })

      try {
        let error = null

        try {
          await runWithTransportDeadline(
            {errorMessage: "Shared frontend model API request timed out", timeoutMs: 40},
            postOperation(`http://127.0.0.1:${controlled.port}/frontend-models`)
          )
        } catch (caught) {
          error = caught
        }

        expect(error).toBeInstanceOf(TimeoutError)
        expect(controlled.state.requestReceived).toBeTrue()

        await waitForCondition(() => controlled.state.socketClosed)

        expect(controlled.state.socketClosed).toBeTrue()
      } finally {
        await controlled.close()
      }
    })

    it("aborts a request whose JSON response body stalls after headers", async () => {
      const controlled = await startControlledServer((_req, res) => {
        res.writeHead(200, {"Content-Type": "application/json"})
        res.write("{\"partial\":")
        // Never end the body.
      })

      try {
        let error = null

        try {
          await runWithTransportDeadline(
            {errorMessage: "Shared frontend model API request timed out", timeoutMs: 40},
            postOperation(`http://127.0.0.1:${controlled.port}/frontend-models`)
          )
        } catch (caught) {
          error = caught
        }

        expect(error).toBeInstanceOf(TimeoutError)
      } finally {
        await controlled.close()
      }
    })

    it("aborts a non-2xx response whose error/text body stalls", async () => {
      const controlled = await startControlledServer((_req, res) => {
        res.writeHead(500, {"Content-Type": "application/json"})
        res.write("{\"errorMessage\":")
        // Never end the error body.
      })

      try {
        let error = null

        try {
          await runWithTransportDeadline(
            {errorMessage: "Shared frontend model API request timed out", timeoutMs: 40},
            postOperation(`http://127.0.0.1:${controlled.port}/frontend-models`)
          )
        } catch (caught) {
          error = caught
        }

        expect(error).toBeInstanceOf(TimeoutError)
      } finally {
        await controlled.close()
      }
    })

    it("returns the response and does not fire the deadline when the request completes in time", async () => {
      const controlled = await startControlledServer((_req, res) => {
        res.writeHead(200, {"Connection": "close", "Content-Type": "application/json"})
        res.end("{\"ok\":true}")
      })

      /** @type {unknown} */
      let unhandledRejection = null
      /** @param {unknown} reason - Rejection reason. */
      const onUnhandledRejection = (reason) => {
        unhandledRejection = reason
      }

      process.on("unhandledRejection", onUnhandledRejection)

      try {
        const result = await runWithTransportDeadline(
          {errorMessage: "Shared frontend model API request timed out", timeoutMs: 1000},
          postOperation(`http://127.0.0.1:${controlled.port}/frontend-models`)
        )

        expect(result.status).toEqual(200)
        expect(result.text).toEqual("{\"ok\":true}")

        // Give any stray timer / late callback a chance to fire — there must be none.
        await wait(60)

        expect(unhandledRejection).toBeNull()
      } finally {
        process.removeListener("unhandledRejection", onUnhandledRejection)
        await controlled.close()
      }
    })
  })

  describe("runWithTransportDeadline cancellation semantics", () => {
    it("propagates a caller abort as its underlying error rather than a timeout", async () => {
      const controller = new AbortController()
      /** @param {AbortSignal} signal - Composed signal. @returns {Promise<never>} - Never resolves; rejects on abort. */
      const operation = (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")))
      })

      const promise = runWithTransportDeadline({errorMessage: "unit", signal: controller.signal, timeoutMs: 1000}, operation)

      controller.abort(new DOMException("Caller cancelled", "AbortError"))

      let error = null

      try {
        await promise
      } catch (caught) {
        error = caught
      }

      expect(error instanceof TimeoutError).toBe(false)
      expect(/** @type {Error} */ (error).name).toEqual("AbortError")
    })

    it("throws a TimeoutError and aborts the operation when the deadline expires before any caller abort", async () => {
      const controller = new AbortController()
      let operationAborted = false
      /** @param {AbortSignal} signal - Composed signal. @returns {Promise<never>} - Never resolves; rejects on abort. */
      const operation = (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          operationAborted = true
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
        })
      })

      let error = null

      try {
        await runWithTransportDeadline({errorMessage: "unit", signal: controller.signal, timeoutMs: 20}, operation)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(TimeoutError)
      expect(operationAborted).toBeTrue()
    })

    it("rejects with the caller reason when the caller signal is already aborted", async () => {
      const controller = new AbortController()

      controller.abort(new DOMException("pre-aborted", "AbortError"))

      let operationRan = false
      let error = null

      try {
        await runWithTransportDeadline({errorMessage: "unit", signal: controller.signal, timeoutMs: 1000}, async () => {
          operationRan = true

          return "should-not-run"
        })
      } catch (caught) {
        error = caught
      }

      expect(operationRan).toBeFalse()
      expect(/** @type {Error} */ (error).name).toEqual("AbortError")
    })

    it("runs the operation without a deadline when no timeout or signal is configured", async () => {
      const result = await runWithTransportDeadline({}, async (signal) => ({aborted: signal.aborted, value: "plain"}))

      expect(result.value).toEqual("plain")
      expect(result.aborted).toBeFalse()
    })
  })

  describe("runWithTransportDeadline resource cleanup", () => {
    it("removes the caller-signal listener on completion", async () => {
      const controller = new AbortController()
      let abortListenersAdded = 0
      let abortListenersRemoved = 0
      const originalAdd = controller.signal.addEventListener.bind(controller.signal)
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal)

      // Count only the deadline's own abort listener add/remove pair.
      controller.signal.addEventListener = /** @type {typeof controller.signal.addEventListener} */ ((type, listener, options) => {
        if (type === "abort") abortListenersAdded += 1

        return originalAdd(type, listener, options)
      })
      controller.signal.removeEventListener = /** @type {typeof controller.signal.removeEventListener} */ ((type, listener, options) => {
        if (type === "abort") abortListenersRemoved += 1

        return originalRemove(type, listener, options)
      })

      const result = await runWithTransportDeadline({errorMessage: "unit", signal: controller.signal, timeoutMs: 1000}, async () => "done")

      expect(result).toEqual("done")
      expect(abortListenersAdded).toEqual(1)
      expect(abortListenersRemoved).toEqual(1)

      // A late caller abort after completion must not throw or resurrect the operation.
      controller.abort()
    })

    it("does not fire the deadline after the operation already resolved", async () => {
      /** @type {unknown} */
      let lateError = null

      const result = await runWithTransportDeadline({errorMessage: "unit", timeoutMs: 30}, async () => "quick")
        .catch((caught) => {
          lateError = caught

          return null
        })

      expect(result).toEqual("quick")

      // Wait past the 30ms deadline to prove the timer was cleared.
      await wait(60)

      expect(lateError).toBeNull()
    })
  })

  describe("FrontendModelBase transport wiring", () => {
    it("bounds a stalled shared frontend-model request through the internal fetch transport", async () => {
      const controlled = await startControlledServer(() => {
        // Never respond.
      })
      const Model = buildSharedApiTestModelClass("DeadlineInternalUser")

      try {
        FrontendModelBase.configureTransport({timeout: 40, url: `http://127.0.0.1:${controlled.port}`})

        let error = null

        try {
          await Model.toArray()
        } catch (caught) {
          error = caught
        }

        expect(error).toBeInstanceOf(TimeoutError)
      } finally {
        resetFrontendModelTransport()
        await controlled.close()
      }
    })

    it("bounds a stalled request through a websocketClient adapter that forwards the deadline signal", async () => {
      const controlled = await startControlledServer(() => {
        // Never respond.
      })
      const Model = buildSharedApiTestModelClass("DeadlineAdapterUser")
      /** @type {Array<AbortSignal | undefined>} */
      const receivedSignals = []

      try {
        FrontendModelBase.configureTransport({
          timeout: 40,
          url: `http://127.0.0.1:${controlled.port}`,
          websocketClient: {
            /**
             * @param {string} path - Request path.
             * @param {Record<string, unknown>} body - Request body.
             * @param {{headers?: Record<string, string>, signal?: AbortSignal}} [options] - Request options.
             * @returns {Promise<{json: () => unknown}>} - Response accessor.
             */
            post: async (path, body, options) => {
              receivedSignals.push(options?.signal)

              const response = await fetch(`http://127.0.0.1:${controlled.port}${path}`, {
                body: JSON.stringify(body),
                headers: options?.headers,
                method: "POST",
                signal: options?.signal
              })
              const json = await response.json()

              return {json: () => json}
            },
            subscribe: () => () => {}
          }
        })

        let error = null

        try {
          await Model.toArray()
        } catch (caught) {
          error = caught
        }

        expect(error).toBeInstanceOf(TimeoutError)
        expect(receivedSignals.length).toBeGreaterThan(0)
        expect(receivedSignals[0]).toBeInstanceOf(AbortSignal)
      } finally {
        resetFrontendModelTransport()
        await controlled.close()
      }
    })
  })
})
