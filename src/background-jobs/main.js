// @ts-check

import net from "net"
import JsonSocket from "./json-socket.js"
import {randomUUID} from "crypto"

export default class BackgroundJobsMain {
  /**
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   */
  constructor({configuration, host, port}) {
    this.configuration = configuration
    const config = configuration.getBackgroundJobsConfig()
    this.host = host || config.host
    this.port = typeof port === "number" ? port : config.port
    /** @type {Array<object>} */
    this.queue = []
    /** @type {Set<JsonSocket>} */
    this.workers = new Set()
    /** @type {Set<JsonSocket>} */
    this.readyWorkers = new Set()
  }

  /**
   * @returns {Promise<void>} - Resolves when listening.
   */
  async start() {
    this.server = net.createServer((socket) => this._handleConnection(socket))

    await new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(this.port, this.host, () => resolve(undefined))
    })

    const address = this.server.address()
    if (address && typeof address === "object") {
      this.port = address.port
    }
  }

  /**
   * @returns {Promise<void>} - Resolves when closed.
   */
  async stop() {
    for (const worker of this.workers) {
      worker.close()
    }

    if (!this.server) return

    await new Promise((resolve) => this.server.close(() => resolve(undefined)))
  }

  /**
   * @returns {number} - Bound port.
   */
  getPort() {
    return this.port
  }

  /**
   * @param {import("net").Socket} socket - Socket.
   * @returns {void}
   */
  _handleConnection(socket) {
    const jsonSocket = new JsonSocket(socket)
    let role = null

    const cleanup = () => {
      if (role === "worker") {
        this.workers.delete(jsonSocket)
        this.readyWorkers.delete(jsonSocket)
      }
    }

    jsonSocket.on("close", cleanup)
    jsonSocket.on("error", cleanup)

    jsonSocket.on("message", (message) => {
      if (!role && message?.type === "hello") {
        role = message.role

        if (role === "worker") {
          this.workers.add(jsonSocket)
          this.readyWorkers.add(jsonSocket)
          this._dispatch()
        }

        return
      }

      if (role === "client" && message?.type === "enqueue") {
        const jobId = randomUUID()
        const options = message.options || {}
        const job = {
          id: jobId,
          jobName: message.jobName,
          args: message.args || [],
          options: {
            forked: options.forked !== false
          }
        }

        this.queue.push(job)
        jsonSocket.send({type: "enqueued", jobId})
        this._dispatch()
        return
      }

      if (role === "worker" && message?.type === "ready") {
        this.readyWorkers.add(jsonSocket)
        this._dispatch()
      }
    })
  }

  _dispatch() {
    if (this.queue.length === 0 || this.readyWorkers.size === 0) return

    const [worker] = this.readyWorkers
    this.readyWorkers.delete(worker)

    const job = this.queue.shift()
    if (!job) return

    worker.send({type: "job", payload: job})
  }
}
