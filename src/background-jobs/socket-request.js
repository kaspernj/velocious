// @ts-check

import net from "net"
import JsonSocket from "./json-socket.js"

export default class BackgroundJobsSocketRequest {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {string} args.host - Host.
   * @param {number} args.port - Port.
   * @param {"client" | "reporter"} args.role - Socket role.
   */
  constructor({host, port, role}) {
    this.host = host
    this.port = port
    this.role = role
  }

  /**
   * Runs run.
   * @template T
   * @param {object} args - Options.
   * @param {(jsonSocket: JsonSocket) => void} args.onConnect - Called after the socket connects.
   * @param {(args: {message: import("./types.js").BackgroundJobSocketMessage, resolve: (value: T) => void, reject: (error: Error) => void}) => void} args.onMessage - Message handler.
   * @param {AbortSignal} [args.signal] - Aborts the request; on abort the pending socket is destroyed and the promise rejects with the signal reason.
   * @returns {Promise<T>} - Resolved request value.
   */
  async run({onConnect, onMessage, signal}) {
    const socket = net.createConnection({host: this.host, port: this.port})
    const jsonSocket = new JsonSocket(socket)

    return await new Promise((resolve, reject) => {
      let finished = false
      /**
       * Finish.
       * @param {object} options - Options.
       * @param {boolean} [options.destroy] - Destroy the socket instead of gracefully closing it.
       * @param {() => void} callback - Finish callback.
       */
      const finish = ({destroy = false} = {}, callback) => {
        if (finished) return
        finished = true
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

      /**
       * Handles the socket response message.
       * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message.
       */
      jsonSocket.on("message", (message) => {
        onMessage({
          message,
          resolve: (value) => finish({}, () => resolve(value)),
          reject: (error) => finish({}, () => reject(error))
        })
      })

      socket.on("connect", () => {
        jsonSocket.send({type: "hello", role: this.role})
        onConnect(jsonSocket)
      })
    })
  }
}
