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
   * @returns {Promise<T>} - Resolved request value.
   */
  async run({onConnect, onMessage}) {
    const socket = net.createConnection({host: this.host, port: this.port})
    const jsonSocket = new JsonSocket(socket)

    return await new Promise((resolve, reject) => {
      let finished = false
      /**
 * Finish.
 * @param {() => void} callback - Finish callback. */
      const finish = (callback) => {
        if (finished) return
        finished = true
        jsonSocket.removeAllListeners()
        jsonSocket.close()
        callback()
      }

      jsonSocket.on("error", (error) => {
        finish(() => reject(error))
      })

      /**
 * Documents this API.
 * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message. */
      jsonSocket.on("message", (message) => {
        onMessage({
          message,
          resolve: (value) => finish(() => resolve(value)),
          reject: (error) => finish(() => reject(error))
        })
      })

      socket.on("connect", () => {
        jsonSocket.send({type: "hello", role: this.role})
        onConnect(jsonSocket)
      })
    })
  }
}
