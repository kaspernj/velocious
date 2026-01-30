// @ts-check

import {digg} from "diggerize"
import EventEmitter from "../utils/event-emitter.js"
import Logger from "../logger.js"
import Net from "net"
import ServerClient from "./server-client.js"
import WorkerHandler from "./worker-handler/index.js"

export default class VelociousHttpServer {
  clientCount = 0

  /** @type {Record<string, ServerClient>}  */
  clients = {}

  events = new EventEmitter()
  workerCount = 0

  /** @type {WorkerHandler[]} */
  workerHandlers = []

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.host] - Host.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxWorkers] - Max workers.
   */
  constructor({configuration, host, maxWorkers, port}) {
    this.configuration = configuration
    this.logger = new Logger(this)
    this.host = host || "0.0.0.0"
    this.port = port || 3006
    this.maxWorkers = maxWorkers || 16
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async start() {
    await this._ensureAtLeastOneWorker()
    this.netServer = new Net.Server()
    this.netServer.on("close", this.onClose)
    this.netServer.on("connection", this.onConnection)
    await this._netServerListen()
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  _netServerListen() {
    return new Promise((resolve, reject) => {
      if (!this.netServer) throw new Error("No netServer")

      try {
        this.netServer.listen(this.port, this.host, () => {
          this.logger.debug(`Velocious listening on ${this.host}:${this.port}`)
          resolve(null)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async _ensureAtLeastOneWorker() {
    if (this.workerHandlers.length == 0) {
      await this.spawnWorker()
    }
  }

  /** @returns {boolean} - Whether active.  */
  isActive() {
    if (this.netServer) {
      return this.netServer.listening
    }

    return false
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async stopClients() {
    const promises = []

    for (const clientCount in this.clients) {
      const client = this.clients[clientCount]

      promises.push(client.end())
    }

    await Promise.all(promises)
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  stopServer() {
    return new Promise((resolve, reject) => {
      if (!this.netServer || !this.netServer.listening) {
        resolve(null)
        return
      }

      this.netServer.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(null)
        }
      })
    })
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async stop() {
    await this.stopClients()
    await this.stopServer()

    const stopTasks = this.workerHandlers.map((handler) => handler.stop())
    await Promise.all(stopTasks)
    this.workerHandlers = []
  }

  /** @returns {void} - No return value.  */
  onClose = () => {
    this.events.emit("close")
  }

  /**
   * @param {import("net").Socket} socket - Socket instance.
   * @returns {void} - No return value.
   */
  onConnection = (socket) => {
    const clientCount = this.clientCount

    this.logger.debug(`New client ${clientCount}`)
    this.clientCount++

    const workerHandler = this.workerHandlerToUse()
    const client = new ServerClient({
      clientCount,
      configuration: this.configuration,
      socket
    })

    client.events.on("close", this.onClientClose)

    this.logger.debug(`Gave client ${clientCount} to worker ${workerHandler.workerCount}`)
    workerHandler.addSocketConnection(client)
    this.clients[clientCount] = client
  }

  /**
   * @param {ServerClient} client - Client instance.
   * @returns {void} - No return value.
   */
  onClientClose = (client) => {
    const clientCount = digg(client, "clientCount")
    const oldClientsLength = Object.keys(this.clients).length

    delete this.clients[clientCount]

    const newClientsLength = Object.keys(this.clients).length

    if (newClientsLength != (oldClientsLength - 1)) {
      console.error(`Expected client to have been removed but length didn't change from ${oldClientsLength} to ${oldClientsLength - 1}`)
    }
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async spawnWorker() {
    const workerCount = this.workerCount

    this.workerCount++

    const workerHandler = new WorkerHandler({
      configuration: this.configuration,
      workerCount
    })

    await workerHandler.start()
    this.workerHandlers.push(workerHandler)
  }

  /** @returns {WorkerHandler} - The worker handler to use.  */
  workerHandlerToUse() {
    this.logger.debug(`Worker handlers length: ${this.workerHandlers.length}`)

    const randomWorkerNumber = Math.floor(Math.random() * this.workerHandlers.length)
    const workerHandler = this.workerHandlers[randomWorkerNumber]

    if (!workerHandler) {
      throw new Error(`No workerHandler by that number: ${randomWorkerNumber}`)
    }

    return workerHandler
  }
}
