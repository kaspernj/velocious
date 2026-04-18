// @ts-check

import {digg} from "diggerize"
import DevelopmentReloader from "./development-reloader.js"
import EventEmitter from "../utils/event-emitter.js"
import InProcessHandler from "./worker-handler/in-process.js"
import Logger from "../logger.js"
import Net from "net"
import ServerClient from "./server-client.js"
import WorkerHandler from "./worker-handler/index.js"

export default class VelociousHttpServer {
  clientCount = 0

  /** @type {Record<string, ServerClient>}  */
  clients = {}

  /** @type {Set<import("net").Socket>} */
  _activeSockets = new Set()

  events = new EventEmitter()
  workerCount = 0

  /** @type {Array<WorkerHandler | InProcessHandler>} */
  workerHandlers = []

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.host] - Host.
   * @param {boolean} [args.inProcess] - Run HTTP handlers in the main thread instead of worker threads.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxWorkers] - Max workers.
   * @param {function({configuration: import("../configuration.js").default, onReload: function({changedPath: string}) : Promise<void>}) : {start: () => Promise<void>, stop: () => Promise<void>}} [args.developmentReloaderFactory] - Development reloader factory.
   */
  constructor({configuration, developmentReloaderFactory, host, inProcess, maxWorkers, port}) {
    this.configuration = configuration
    this.developmentReloaderFactory = developmentReloaderFactory
    this.inProcess = inProcess || false
    this.logger = new Logger(this)
    this.host = host || "0.0.0.0"
    this.port = port || 3006
    this.maxWorkers = maxWorkers || 16
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async start() {
    await this._ensureAtLeastOneWorker()
    await this._startDevelopmentReloader()
    this.netServer = new Net.Server()
    this.netServer.on("close", this.onClose)
    this.netServer.on("connection", this.onConnection)
    this.netServer.on("error", this.onServerError)
    await this._netServerListen()
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  _netServerListen() {
    return new Promise((resolve, reject) => {
      if (!this.netServer) throw new Error("No netServer")

      try {
        this.netServer.listen(this.port, this.host, () => {
          this.logger.debug(`Velocious listening on ${this.host}:${this.port}`)
          resolve(undefined)
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
        resolve(undefined)
        return
      }

      // Force-close lingering sockets (e.g. WebSocket upgrade
      // connections mid-close-handshake) so the port is released
      // immediately instead of waiting for graceful drain.
      for (const socket of this._activeSockets) {
        socket.destroy()
      }

      this._activeSockets.clear()

      this.netServer.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(undefined)
        }
      })
    })
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async stop() {
    this._stopping = true
    await this.developmentReloader?.stop()
    this.developmentReloader = undefined
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
   * @param {Error} error - Server socket error.
   * @returns {void} - No return value.
   */
  onServerError = (error) => {
    this.logger.error(`Velocious HTTP server socket error on ${this.host}:${this.port}`, error)
  }

  /**
   * @param {import("net").Socket} socket - Socket instance.
   * @returns {void} - No return value.
   */
  onConnection = (socket) => {
    const clientCount = this.clientCount

    this._activeSockets.add(socket)
    socket.once("close", () => this._activeSockets.delete(socket))

    this.logger.debug(() => ["New client", {
      clientCount,
      remoteAddress: socket.remoteAddress,
      remoteFamily: socket.remoteFamily,
      remotePort: socket.remotePort
    }])
    this.clientCount++

    try {
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
    } catch (error) {
      this.logger.error(`Failed to initialize client ${clientCount} on new connection`, error)
      socket.destroy()
    }
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
      this.logger.error(`Expected client to have been removed but length didn't change from ${oldClientsLength} to ${oldClientsLength - 1}`)
    }
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async spawnWorker() {
    const workerHandler = await this._buildWorkerHandler()

    this.workerHandlers.push(workerHandler)
  }

  /** @returns {Promise<WorkerHandler | InProcessHandler>} - Started worker handler. */
  async _buildWorkerHandler() {
    const workerCount = this.workerCount

    this.workerCount++

    const Handler = this.inProcess ? InProcessHandler : WorkerHandler
    const workerHandler = new Handler({
      configuration: this.configuration,
      workerCount
    })

    await workerHandler.start()

    return workerHandler
  }

  /** @returns {WorkerHandler | InProcessHandler} - The worker handler to use. */
  workerHandlerToUse() {
    this.logger.debug(`Worker handlers length: ${this.workerHandlers.length}`)

    const randomWorkerNumber = Math.floor(Math.random() * this.workerHandlers.length)
    const workerHandler = this.workerHandlers[randomWorkerNumber]

    if (!workerHandler) {
      throw new Error(`No workerHandler by that number: ${randomWorkerNumber}`)
    }

    return workerHandler
  }

  /** @returns {boolean} - Whether development worker hot reload should run. */
  shouldUseDevelopmentHotReload() {
    return !this.inProcess && this.configuration.getEnvironment() === "development"
  }

  /** @returns {Promise<void>} - Resolves when watcher setup finishes. */
  async _startDevelopmentReloader() {
    if (!this.shouldUseDevelopmentHotReload()) return
    if (this.developmentReloader) return

    const createDevelopmentReloader = this.developmentReloaderFactory
      || ((args) => new DevelopmentReloader(args))

    this.developmentReloader = createDevelopmentReloader({
      configuration: this.configuration,
      onReload: async ({changedPath}) => {
        await this.logger.info(`Development hot reload detected change in ${changedPath}`)
        await this.reloadWorkersForDevelopment()
      }
    })

    await this.developmentReloader.start()
  }

  /** @returns {Promise<void>} - Resolves when workers have been refreshed. */
  async reloadWorkersForDevelopment() {
    if (this._stopping) return

    if (this._reloadingWorkersForDevelopment) {
      this._reloadWorkersForDevelopmentQueued = true
      return
    }

    this._reloadingWorkersForDevelopment = true

    try {
      do {
        this._reloadWorkersForDevelopmentQueued = false

        const oldWorkerHandlers = [...this.workerHandlers]
        const newWorkerHandler = await this._buildWorkerHandler()

        this.workerHandlers = [newWorkerHandler]

        await Promise.all(oldWorkerHandlers.map((workerHandler) => workerHandler.stop()))
      } while (this._reloadWorkersForDevelopmentQueued && !this._stopping)
    } finally {
      this._reloadingWorkersForDevelopment = false
    }
  }
}
