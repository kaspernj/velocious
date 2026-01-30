// @ts-check

import net from "net"
import Request from "./request.js"
import Response from "./response.js"
import Logger from "../logger.js"

export default class HttpClient {
  /**
   * @param {object} args - Options object.
   * @param {boolean} [args.debug] - Whether debug.
   * @param {Array<import("./header.js").default>} [args.headers] - Header list.
   * @param {string} [args.version] - Version.
   */
  constructor({debug = false, headers, version = "1.1"}) {
    this.headers = headers || []
    this.logger = new Logger(this, {debug})
    this.version = version
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.connectionReject = reject
      this.connection = net.createConnection(3006, "127.0.0.1", () => {
        this.connectionReject = null
        resolve(null)
      })

      this.connection.on("data", this.onConnectionData)
      this.connection.on("end", this.onConnectionEnd)
      this.connection.on("error", this.onConnectionError)
    })
  }

  /**
   * @param {string} path - Path.
   * @param {object} [options] - Options object.
   * @param {Array<import("./header.js").default>} [options.headers] - Header list.
   * @returns {Promise<{request: import("./request.js").default, response: import("./response.js").default}>} - Resolves with the request/response pair.
   */
  get(path, {headers} = {}) {
    if (!this.connection) throw new Error("Not connected yet")

    return new Promise((resolve, reject) => {
      this.currentRequestResolve = resolve
      this.currentRequestReject = reject

      const newHeaders = []

      if (headers) {
        for (const header of headers) {
          newHeaders.push(header)
        }
      }

      for (const header of this.headers) {
        const existingNewHeader = newHeaders.find((newHeader) => {
          return newHeader.getName().toLowerCase().trim() === header.getName().toLowerCase().trim()
        })

        if (!existingNewHeader) {
      this.logger.debugLowLevel(() => `Pushing header from connection: ${header.toString()}`)
          newHeaders.push(header)
        }
      }

      this.currentResponse = new Response({method: "GET", onComplete: this.onResponseComplete})

      this.currentRequest = new Request({headers: newHeaders, method: "GET", path, version: "1.0"})
      this.currentRequest.stream((chunk) => {
        this.logger.debugLowLevel(() => `Writing: ${chunk}`)

        if (!this.connection) {
          throw new Error("No connection to write to")
        }

        this.connection.write(chunk, "utf8", (error) => {
          if (error) {
            if (!this.currentRequestReject) throw new Error("No current request reject function")

            this.currentRequestReject(error)
          }
        })
      })
    })
  }

  /**
   * @param {Buffer} data - Data payload.
   */
  onConnectionData = (data) => {
    if (!this.currentResponse) throw new Error("No current response to feed data to")

    this.currentResponse.feed(data)
  }

  onConnectionEnd = () => {
    this.connection = null
  }

  /**
   * @param {Error} error - Error instance.
   */
  onConnectionError = (error) => {
    if (this.connectionReject) {
      this.connectionReject(error)
    } else {
      this.logger.error("HttpClient onConnectionError", error)
    }
  }

  isConnected() {
    if (this.connection) {
      return true
    }

    return false
  }

  onResponseComplete = () => {
    if (!this.currentRequestResolve) throw new Error("No current request resolve function")
    if (!this.currentRequest) throw new Error("No current request")
    if (!this.currentResponse) throw new Error("No current response")

    this.currentRequestResolve({
      request: this.currentRequest,
      response: this.currentResponse
    })

    this.currentRequestResolve = null
    this.currentRequestReject = null
    this.currentRequest = null
    this.currentResponse = null
  }
}
