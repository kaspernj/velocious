import net from "net"
import Request from "./request.js"
import Response from "./response.js"
import {Logger} from "../logger.js"

export default class HttpClient {
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
        resolve()
      })

      this.connection.on("data", this.onConnectionData)
      this.connection.on("end", this.onConnectionEnd)
      this.connection.on("error", this.onConnectionError)
    })
  }

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
          return newHeader.key.toLowerCase().trim() === header.key.toLowerCase().trim()
        })

        if (!existingNewHeader) {
          this.logger.debug(() => [`Pushing header from connection: ${header.toString()}`])
          newHeaders.push(header)
        }
      }

      this.currentResponse = new Response({method: "GET", onComplete: this.onResponseComplete})

      this.currentRequest = new Request({headers: newHeaders, method: "GET", path, version: "1.0"})
      this.currentRequest.stream((chunk) => {
        this.logger.debug(() => [`Writing: ${chunk}`])

        this.connection.write(chunk, "utf8", (error) => {
          if (error) {
            this.currentRequestReject(error)
          }
        })
      })
    })
  }

  onConnectionData = (data) => {
    this.currentResponse.feed(data)
  }

  onConnectionEnd = () => {
    this.connection = null
  }

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
