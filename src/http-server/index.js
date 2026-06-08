// @ts-check

import {digg} from "diggerize"
import DevelopmentReloader from "./development-reloader.js"
import EventEmitter from "../utils/event-emitter.js"
import InProcessHandler from "./worker-handler/in-process.js"
import Logger from "../logger.js"
import Net from "net"
import ServerClient from "./server-client.js"
import WorkerHandler from "./worker-handler/index.js"

/** @typedef {{start: () => Promise<void>, stop: () => Promise<void>}} DevelopmentReloaderLike */
/** @typedef {function({configuration: import("../configuration.js").default, workerCount: number}) : (WorkerHandler | InProcessHandler)} WorkerHandlerFactory */

/**
 * @param {object} args - Options object.
 * @param {number} [args.maxWorkers] - Backward-compatible worker count alias.
 * @param {number} [args.workers] - Configured worker count.
 * @returns {number} - Normalized worker count.
 */
function normalizeWorkerCount({maxWorkers, workers}) {
  const workerCount = workers ?? maxWorkers ?? 1

  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error("HTTP server workers must be a positive integer")
  }

  return workerCount
}

export default class VelociousHttpServer {
  clientCount = 0
  _starting = false

  /** @type {DevelopmentReloader | DevelopmentReloaderLike | undefined} */
  developmentReloader

  /** @type {import("net").Server | undefined} */
  netServer

  /** @type {WorkerHandlerFactory | undefined} */
  workerHandlerFactory

  /** @type {Record<string, ServerClient>}  */
  clients = {}

  /** @type {Set<import("net").Socket>} */
  _activeSockets = new Set()

  events = new EventEmitter()
  workerCount = 0

  /** @type {Array<WorkerHandler | InProcessHandler>} */
  workerHandlers = []
  nextWorkerHandlerIndex = 0
  /** @type {Map<string, WorkerHandler | InProcessHandler>} */
  stickyWorkerHandlers = new Map()

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.host] - Host.
   * @param {boolean} [args.inProcess] - Run HTTP handlers in the main thread instead of worker threads.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxWorkers] - Max workers.
   * @param {number} [args.workers] - Worker handlers to start.
   * @param {function({configuration: import("../configuration.js").default, onReload: function({changedPath: string}) : Promise<void>}) : {start: () => Promise<void>, stop: () => Promise<void>}} [args.developmentReloaderFactory] - Development reloader factory.
   * @param {WorkerHandlerFactory} [args.workerHandlerFactory] - Worker handler factory.
   */
  constructor({configuration, developmentReloaderFactory, host, inProcess, maxWorkers, port, workerHandlerFactory, workers}) {
    this.configuration = configuration
    this.developmentReloaderFactory = developmentReloaderFactory
    this.workerHandlerFactory = workerHandlerFactory
    this.inProcess = inProcess || false
    this.logger = new Logger(this)
    this.host = host ?? "0.0.0.0"
    this.port = port ?? 3006
    this.workers = normalizeWorkerCount({maxWorkers, workers})
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async start() {
    if (this._starting) throw new Error("Velocious HTTP server is already starting")
    if (this.isActive()) throw new Error("Velocious HTTP server is already running")

    this._starting = true
    const startupState = this._captureStartupState()

    try {
      await this._ensureWorkers()
      await this._startDevelopmentReloader()
      /** @type {import("net").Server} */
      const netServer = new Net.Server()
      this.netServer = netServer
      netServer.on("close", this.onClose)
      netServer.on("connection", this.onConnection)
      netServer.on("error", this.onServerError)
      await this._netServerListen()
    } catch (error) {
      await this._stopStartupResources(startupState)
      throw error
    } finally {
      this._starting = false
    }
  }

  /** @returns {{developmentReloader: DevelopmentReloader | DevelopmentReloaderLike | undefined, netServer: import("net").Server | undefined, workerHandlers: Array<WorkerHandler | InProcessHandler>}} - Startup state. */
  _captureStartupState() {
    return {
      developmentReloader: this.developmentReloader,
      netServer: this.netServer,
      workerHandlers: [...this.workerHandlers]
    }
  }

  /**
   * @param {ReturnType<VelociousHttpServer["_captureStartupState"]>} startupState - State captured before startup.
   * @returns {Promise<void>} - Resolves when cleanup is complete.
   */
  async _stopStartupResources(startupState) {
    /** @type {import("net").Server | undefined} */
    const startupNetServer = this.netServer

    if (this.developmentReloader && this.developmentReloader !== startupState.developmentReloader) {
      await this.developmentReloader.stop()
    }

    if (startupNetServer && startupNetServer !== startupState.netServer) {
      await this.stopServer(startupNetServer)
    }

    const startupWorkerHandlers = this.workerHandlers.filter((workerHandler) => !startupState.workerHandlers.includes(workerHandler))

    await Promise.all(startupWorkerHandlers.map((handler) => handler.stop()))

    this.developmentReloader = startupState.developmentReloader
    this.netServer = startupState.netServer
    this.workerHandlers = startupState.workerHandlers
    this.stickyWorkerHandlers.clear()
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  _netServerListen() {
    return new Promise((resolve, reject) => {
      if (!this.netServer) throw new Error("No netServer")

      /** @param {Error} error - Listen error. */
      const onListenError = (error) => {
        this.netServer?.off("error", onListenError)
        reject(error)
      }

      try {
        this.netServer.once("error", onListenError)
        this.netServer.listen(this.port, this.host, () => {
          this.netServer?.off("error", onListenError)
          this.logger.debug(`Velocious listening on ${this.host}:${this.port}`)
          resolve(undefined)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async _ensureWorkers() {
    while (this.workerHandlers.length < this.workers) {
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

  /** @returns {Promise<Record<string, unknown>>} - HTTP server worker diagnostics. */
  async getDebugSnapshot() {
    return {
      active: this.isActive(),
      activeSocketCount: this._activeSockets.size,
      clientCount: Object.keys(this.clients).length,
      configuredWorkerCount: this.workers,
      inProcess: this.inProcess,
      workerCount: this.workerHandlers.length,
      workers: await Promise.all(this.workerHandlers.map((handler) => handler.getDebugSnapshot()))
    }
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

  /**
   * @param {import("net").Server | undefined} [netServer] - Server to stop.
   * @returns {Promise<void>} - Resolves when complete.
   */
  stopServer(netServer = this.netServer) {
    return new Promise((resolve, reject) => {
      if (!netServer || !netServer.listening) {
        resolve(undefined)
        return
      }

      if (netServer === this.netServer) {
        // Force-close lingering sockets (e.g. WebSocket upgrade
        // connections mid-close-handshake) so the port is released
        // immediately instead of waiting for graceful drain.
        for (const socket of this._activeSockets) {
          socket.destroy()
        }

        this._activeSockets.clear()
      }

      netServer.close((error) => {
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
    this.stickyWorkerHandlers.clear()
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
      // Paused WebSocket sessions are worker-local, so reconnects from
      // the same client address must return to the same worker.
      const workerHandler = this.workerHandlerToUse({stickyKey: socket.remoteAddress})
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

  /** @returns {Promise<Array<WorkerHandler | InProcessHandler>>} - Started worker handlers. */
  async _buildWorkerHandlers() {
    /** @type {Array<WorkerHandler | InProcessHandler>} */
    const workerHandlers = []

    for (let index = 0; index < this.workers; index += 1) {
      workerHandlers.push(await this._buildWorkerHandler())
    }

    return workerHandlers
  }

  /** @returns {Promise<WorkerHandler | InProcessHandler>} - Started worker handler. */
  async _buildWorkerHandler() {
    const workerCount = this.workerCount

    this.workerCount++

    const Handler = this.inProcess ? InProcessHandler : WorkerHandler
    const workerHandler = this.workerHandlerFactory
      ? this.workerHandlerFactory({configuration: this.configuration, workerCount})
      : new Handler({
        configuration: this.configuration,
        workerCount
      })

    await workerHandler.start()

    return workerHandler
  }

  /**
   * @param {object} [args] - Options object.
   * @param {string} [args.stickyKey] - Stable key that must keep routing to the same worker.
   * @returns {WorkerHandler | InProcessHandler} - The worker handler to use.
   */
  workerHandlerToUse({stickyKey} = {}) {
    if (stickyKey) {
      const stickyWorkerHandler = this.stickyWorkerHandlers.get(stickyKey)

      if (stickyWorkerHandler && this.workerHandlers.includes(stickyWorkerHandler)) {
        return stickyWorkerHandler
      }

      const workerHandler = this._nextRoundRobinWorkerHandler()

      this.stickyWorkerHandlers.set(stickyKey, workerHandler)

      return workerHandler
    }

    return this._nextRoundRobinWorkerHandler()
  }

  /** @returns {WorkerHandler | InProcessHandler} - The next round-robin worker handler. */
  _nextRoundRobinWorkerHandler() {
    this.logger.debug(`Worker handlers length: ${this.workerHandlers.length}`)

    const workerHandlerIndex = this.nextWorkerHandlerIndex % this.workerHandlers.length
    const workerHandler = this.workerHandlers[workerHandlerIndex]

    if (!workerHandler) {
      throw new Error(`No workerHandler by that number: ${workerHandlerIndex}`)
    }

    this.nextWorkerHandlerIndex += 1

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
        const newWorkerHandlers = await this._buildWorkerHandlers()

        this.workerHandlers = newWorkerHandlers
        this.nextWorkerHandlerIndex = 0
        this.stickyWorkerHandlers.clear()

        await Promise.all(oldWorkerHandlers.map((workerHandler) => workerHandler.stop()))
      } while (this._reloadWorkersForDevelopmentQueued && !this._stopping)
    } finally {
      this._reloadingWorkersForDevelopment = false
    }
  }
}
