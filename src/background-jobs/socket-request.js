// @ts-check

import net from "net"
import JsonSocket from "./json-socket.js"
import BackgroundJobsGenerationHandshakeTimeoutError, { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js"

export default class BackgroundJobsSocketRequest {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {string} args.host - Host.
   * @param {number} args.port - Port.
   * @param {"client" | "reporter"} args.role - Socket role.
   * @param {string} [args.generationId] - Release generation identity.
   * @param {number} [args.generationHandshakeTimeoutMs] - Generation acknowledgement deadline.
   */
  constructor({host, port, role, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, generationId}) {
    this.host = host
    this.port = port
    this.role = role
    this.generationId = generationId
    this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs)
    /**
     * Internal test-only observability reference — NOT public API. Holds the
     * JsonSocket wrapper this request created so the timeout spec can inspect the
     * wrapper's own `destroy()`/`close()` call counters — direct evidence of which
     * teardown method actually ran, not a self-reported flag. Retains the single
     * (already torn-down) wrapper for the request's lifetime. Do not expose or
     * depend on this outside tests.
     * @type {JsonSocket | undefined}
     */
    this._jsonSocket = undefined
  }

  /**
   * Runs run.
   * @template T
   * @param {object} args - Options.
   * @param {(jsonSocket: JsonSocket) => void} args.onConnect - Called after the socket connects.
   * @param {(args: {message: import("./types.js").BackgroundJobSocketMessage, resolve: (value: T) => void, reject: (error: Error) => void}) => void} args.onMessage - Message handler.
   * @param {AbortSignal} [args.signal] - Aborts the request; on abort the pending socket is destroyed and the promise rejects with the signal reason when it is an Error, otherwise with a generic abort Error.
   * @returns {Promise<T>} - Resolved request value.
   */
  async run({onConnect, onMessage, signal}) {
    const socket = net.createConnection({host: this.host, port: this.port})
    const jsonSocket = new JsonSocket(socket)

    this._jsonSocket = jsonSocket

    return await new Promise((resolve, reject) => {
      let finished = false
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let handshakeTimer
      /**
       * Finish.
       * @param {object} options - Options.
       * @param {boolean} [options.destroy] - Destroy the socket instead of gracefully closing it.
       * @param {() => void} callback - Finish callback.
       */
      const finish = ({destroy = false} = {}, callback) => {
        if (finished) return
        finished = true
        if (handshakeTimer) clearTimeout(handshakeTimer)
        if (signal) signal.removeEventListener("abort", onAbort)
        jsonSocket.removeAllListeners()

        if (destroy) {
          jsonSocket.destroy()
        } else {
          jsonSocket.close()
        }

        callback()
      }

      /**
       * Handles a cooperative abort: tears down the pending socket and rejects
       * with the signal reason when it is an Error.
       * @returns {void}
       */
      const onAbort = () => {
        const reason = signal?.reason

        finish({destroy: true}, () => reject(reason instanceof Error ? reason : new Error("Background job socket request aborted")))
      }

      if (signal) {
        if (signal.aborted) {
          onAbort()
          return
        }

        signal.addEventListener("abort", onAbort)
      }

      jsonSocket.on("error", (error) => {
        finish({}, () => reject(error))
      })

      jsonSocket.on("close", () => {
        finish({destroy: true}, () => reject(new Error("Background jobs socket closed before the request was acknowledged")))
      })

      /**
       * Handles the socket response message.
       * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message.
       */
      jsonSocket.on("message", (message) => {
        if (this.generationId && message?.type === "generation-accepted") {
          if (message.generationId !== this.generationId) {
            finish({destroy: true}, () => reject(new Error("Background jobs main acknowledged a different generation")))
            return
          }

          if (handshakeTimer) {
            clearTimeout(handshakeTimer)
            handshakeTimer = undefined
          }
          onConnect(jsonSocket)
          return
        }

        if (this.generationId && message?.type === "generation-rejected") {
          finish({destroy: true}, () => reject(new Error(`Background jobs generation rejected: ${message.reason}`)))
          return
        }

        onMessage({
          message,
          resolve: (value) => finish({}, () => resolve(value)),
          reject: (error) => finish({}, () => reject(error))
        })
      })

      if (this.generationId) {
        handshakeTimer = setTimeout(() => {
          const error = new BackgroundJobsGenerationHandshakeTimeoutError({
            endpoint: `${this.host}:${this.port}`,
            generationId: this.generationId || "",
            role: this.role,
            timeoutMs: this.generationHandshakeTimeoutMs
          })
          finish({destroy: true}, () => reject(error))
        }, this.generationHandshakeTimeoutMs)
      }

      socket.on("connect", () => {
        jsonSocket.send({type: "hello", role: this.role, ...(this.generationId ? {generationId: this.generationId} : {})})
        if (!this.generationId) {
          onConnect(jsonSocket)
        }
      })
    })
  }
}
