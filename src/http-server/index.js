// @ts-check

import {digg} from "diggerize"
import DevelopmentReloader from "./development-reloader.js"
import EventEmitter from "../utils/event-emitter.js"
import InProcessHandler from "./worker-handler/in-process.js"
import Logger from "../logger.js"
import Net from "net"
import os from "node:os"
import ServerClient from "./server-client.js"
import WorkerHandler from "./worker-handler/index.js"

/**
 * Defines this typedef.
 * @typedef {{start: () => Promise<void>, stop: () => Promise<void>}} DevelopmentReloaderLike */
/**
 * Defines this typedef.
 * @typedef {(args: {configuration: import("../configuration.js").default, onWebsocketSessionOwned: (args: {sessionId: string, workerHandler: WorkerHandler}) => void, onWebsocketSessionReleased: (args: {sessionId: string, workerHandler: WorkerHandler}) => void, onWorkerStopped: (args: {workerHandler: WorkerHandler}) => void, workerCount: number}) => (WorkerHandler | InProcessHandler)} WorkerHandlerFactory */

/**
 * Runs normalize worker count.
 * @param {object} args - Options object.
 * @param {number} [args.maxWorkers] - Backward-compatible worker count alias.
 * @param {number} [args.workers] - Configured worker count.
 * @param {number} args.defaultWorkerCount - Process-available CPU count.
 * @returns {number} - Normalized worker count.
 */
function normalizeWorkerCount({defaultWorkerCount, maxWorkers, workers}) {
  const workerCount = workers ?? maxWorkers ?? defaultWorkerCount

  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error("HTTP server workers must be a positive integer")
  }

  return workerCount
}

const MAX_INITIAL_REQUEST_HEADER_BYTES = 64 * 1024
const WEBSOCKET_SESSION_ROUTING_PARAMETER = "velociousSessionId"

export default class VelociousHttpServer {
  clientCount = 0
  _starting = false

  /**
   * Narrows the runtime value to the documented type.
   * @type {DevelopmentReloader | DevelopmentReloaderLike | undefined} */
  developmentReloader

  /**
   * Narrows the runtime value to the documented type.
   * @type {import("net").Server | undefined} */
  netServer

  /**
   * Narrows the runtime value to the documented type.
   * @type {WorkerHandlerFactory | undefined} */
  workerHandlerFactory

  /**
   * Clients.
   * @type {Record<string, ServerClient>}  */
  clients = {}

  /**
   * Active sockets.
   * @type {Set<import("net").Socket>} */
  _activeSockets = new Set()

  events = new EventEmitter()
  workerCount = 0

  /**
   * Worker handlers.
   * @type {Array<WorkerHandler | InProcessHandler>} */
  workerHandlers = []
  nextWorkerHandlerIndex = 0
  /** Worker ownership for live or grace-paused resumable WebSocket sessions. */
  websocketSessionOwners = new Map()

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.host] - Host.
   * @param {boolean} [args.inProcess] - Run HTTP handlers in the main thread instead of worker threads.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxWorkers] - Max workers.
   * @param {number} [args.workers] - Worker handlers to start.
   * @param {() => number} [args.availableParallelism] - CPU availability owner seam.
   * @param {(args: {configuration: import("../configuration.js").default, onReload: (args: {changedPath: string}) => Promise<void>}) => {start: () => Promise<void>, stop: () => Promise<void>}} [args.developmentReloaderFactory] - Development reloader factory.
   * @param {WorkerHandlerFactory} [args.workerHandlerFactory] - Worker handler factory.
   */
  constructor({availableParallelism = os.availableParallelism, configuration, developmentReloaderFactory, host, inProcess, maxWorkers, port, workerHandlerFactory, workers}) {
    this.configuration = configuration
    this.developmentReloaderFactory = developmentReloaderFactory
    this.workerHandlerFactory = workerHandlerFactory
    this.inProcess = inProcess || false
    this.logger = new Logger(this)
    this.host = host ?? "0.0.0.0"
    this.port = port ?? 3006
    this.workers = normalizeWorkerCount({defaultWorkerCount: availableParallelism(), maxWorkers, workers})
    this.effectiveWorkers = this.inProcess && workers === undefined && maxWorkers === undefined ? 1 : this.workers
  }

  /**
   * Runs start.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async start() {
    if (this._starting) throw new Error("Velocious HTTP server is already starting")
    if (this.isActive()) throw new Error("Velocious HTTP server is already running")

    this._starting = true
    const startupState = this._captureStartupState()

    try {
      await this._ensureWorkers()
      await this._startDevelopmentReloader()
      /**
       * Net server.
       * @type {import("net").Server} */
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

  /**
   * Runs capture startup state.
   * @returns {{developmentReloader: DevelopmentReloader | DevelopmentReloaderLike | undefined, netServer: import("net").Server | undefined, workerHandlers: Array<WorkerHandler | InProcessHandler>}} - Startup state.
   */
  _captureStartupState() {
    return {
      developmentReloader: this.developmentReloader,
      netServer: this.netServer,
      workerHandlers: [...this.workerHandlers]
    }
  }

  /**
   * Runs stop startup resources.
   * @param {ReturnType<VelociousHttpServer["_captureStartupState"]>} startupState - State captured before startup.
   * @returns {Promise<void>} - Resolves when cleanup is complete.
   */
  async _stopStartupResources(startupState) {
    /**
     * Startup net server.
     * @type {import("net").Server | undefined} */
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
    this.websocketSessionOwners.clear()
  }

  /**
   * Runs net server listen.
   * @returns {Promise<void>} - Resolves when complete.
   */
  _netServerListen() {
    return new Promise((resolve, reject) => {
      if (!this.netServer) throw new Error("No netServer")

      /**
       * On listen error.
       * @param {Error} error - Listen error.
       */
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

  /**
   * Runs ensure workers.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureWorkers() {
    while (this.workerHandlers.length < this.effectiveWorkers) {
      await this.spawnWorker()
    }
  }

  /**
   * Runs is active.
   * @returns {boolean} - Whether active.
   */
  isActive() {
    if (this.netServer) {
      return this.netServer.listening
    }

    return false
  }

  /**
   * Runs get debug snapshot.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - HTTP server worker diagnostics.
   */
  async getDebugSnapshot() {
    return {
      active: this.isActive(),
      activeSocketCount: this._activeSockets.size,
      clientCount: Object.keys(this.clients).length,
      configuredWorkerCount: this.workers,
      effectiveWorkerCount: this.effectiveWorkers,
      inProcess: this.inProcess,
      workerCount: this.workerHandlers.length,
      workers: await Promise.all(this.workerHandlers.map((handler) => this.workerDebugSnapshot(handler)))
    }
  }

  /**
   * Runs worker debug snapshot.
   * @param {WorkerHandler | InProcessHandler} workerHandler - Worker handler to inspect.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Worker debug snapshot.
   */
  async workerDebugSnapshot(workerHandler) {
    if (workerHandler instanceof WorkerHandler) return await workerHandler.getDebugSnapshot()
    if (workerHandler instanceof InProcessHandler) return this.inProcessWorkerDebugSnapshot(workerHandler)

    return {active: false, error: "Unknown worker handler type"}
  }

  /**
   * Runs in process worker debug snapshot.
   * @param {InProcessHandler} workerHandler - In-process worker handler to inspect.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} Worker debug snapshot.
   */
  inProcessWorkerDebugSnapshot(workerHandler) {
    return {
      active: true,
      clientCount: Object.keys(workerHandler.clients).length,
      snapshot: workerHandler.configuration.getLocalDebugSnapshot(),
      workerCount: workerHandler.workerCount
    }
  }

  /**
   * Runs stop clients.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async stopClients() {
    const promises = []

    for (const clientCount in this.clients) {
      const client = this.clients[clientCount]

      promises.push(client.end())
    }

    await Promise.all(promises)
  }

  /**
   * Runs stop server.
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

  /**
   * Runs stop.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async stop() {
    this._stopping = true
    await this.developmentReloader?.stop()
    this.developmentReloader = undefined
    await this.stopClients()
    await this.stopServer()

    const stopTasks = this.workerHandlers.map((handler) => handler.stop())
    await Promise.all(stopTasks)
    this.workerHandlers = []
    this.websocketSessionOwners.clear()
  }

  /**
   * On close.
   * @returns {void} - No return value.
   */
  onClose = () => {
    this.events.emit("close")
  }

  /**
   * On server error.
   * @param {Error} error - Server socket error.
   * @returns {void} - No return value.
   */
  onServerError = (error) => {
    this.logger.error(`Velocious HTTP server socket error on ${this.host}:${this.port}`, error)
  }

  /**
   * On connection.
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
      const client = new ServerClient({
        clientCount,
        configuration: this.configuration,
        socket
      })

      client.events.on("close", this.onClientClose)
      this.clients[clientCount] = client
      this.routeClientAfterInitialRoutingData(client)
    } catch (error) {
      this.logger.error(`Failed to initialize client ${clientCount} on new connection`, error)
      socket.destroy()
    }
  }

  /**
   * Buffers only the bounded initial request data needed to recognize a
   * WebSocket resume routing hint, then replays it to the selected worker.
   * @param {ServerClient} client - Unassigned socket client.
   * @returns {void}
   */
  routeClientAfterInitialRoutingData(client) {
    const {socket} = client
    /** @type {Buffer[]} */
    const chunks = []
    let byteLength = 0
    const cleanup = () => {
      socket.off("data", onData)
      socket.off("close", cleanup)
    }
    const onData = (/** @type {Buffer} */ chunk) => {
      chunks.push(chunk)
      byteLength += chunk.length
      const initialRequest = Buffer.concat(chunks, byteLength)

      if (this.initialRequestNeedsMoreRoutingData(initialRequest) && byteLength < MAX_INITIAL_REQUEST_HEADER_BYTES) return

      cleanup()
      this.assignClientToWorker(client, initialRequest)
    }

    socket.on("data", onData)
    socket.once("close", cleanup)
  }

  /**
   * Checks whether the buffered initial HTTP headers are complete.
   * @param {Buffer} initialRequest - Buffered initial request bytes.
   * @returns {boolean} - Whether a header terminator is present.
   */
  initialRequestHeadersComplete(initialRequest) {
    return initialRequest.includes("\r\n\r\n") || initialRequest.includes("\n\n")
  }

  /**
   * Checks whether a possible resumable WebSocket request still needs headers.
   * Ordinary and malformed requests can reach the existing request parser as
   * soon as their first line is complete.
   * @param {Buffer} initialRequest - Buffered initial request bytes.
   * @returns {boolean} - Whether more routing data is required.
   */
  initialRequestNeedsMoreRoutingData(initialRequest) {
    if (this.initialRequestHeadersComplete(initialRequest)) return false

    const lineEnd = initialRequest.indexOf("\n")

    if (lineEnd === -1) return true

    const requestLine = initialRequest.subarray(0, lineEnd).toString("latin1").replace(/\r$/, "")
    const requestLineMatch = requestLine.match(/^GET ([^ ]+) HTTP\/[^ ]+$/)

    if (!requestLineMatch) return false

    try {
      const requestUrl = new URL(requestLineMatch[1], "http://velocious.invalid")

      return requestUrl.searchParams.has(WEBSOCKET_SESSION_ROUTING_PARAMETER)
    } catch {
      return false
    }
  }

  /**
   * Assigns a buffered client and replays the exact bytes into its worker.
   * @param {ServerClient} client - Client awaiting assignment.
   * @param {Buffer} initialRequest - Initial request bytes.
   * @returns {void}
   */
  assignClientToWorker(client, initialRequest) {
    if (client.socket.destroyed) return

    try {
      const workerHandler = this.workerHandlerForInitialRequest(initialRequest)

      this.logger.debug(`Gave client ${client.clientCount} to worker ${workerHandler.workerCount}`)
      workerHandler.addSocketConnection(client)
      client.onSocketData(initialRequest)
    } catch (error) {
      this.logger.error(`Failed to assign client ${client.clientCount} to a worker`, error)
      client.destroy(error instanceof Error ? error : new Error("Failed to assign HTTP client to worker", {cause: error}))
    }
  }

  /**
   * Selects the owner of a resumable WebSocket session or the next ordinary worker.
   * @param {Buffer} initialRequest - Initial HTTP request headers.
   * @returns {WorkerHandler | InProcessHandler} - Selected worker.
   */
  workerHandlerForInitialRequest(initialRequest) {
    const sessionId = this.websocketResumeSessionId(initialRequest)

    if (sessionId) {
      const owner = this.websocketSessionOwners.get(sessionId)

      if (owner && this.workerHandlers.includes(owner)) return owner
      if (owner) this.websocketSessionOwners.delete(sessionId)
    }

    return this.workerHandlerToUse()
  }

  /**
   * Reads the resumable WebSocket session routing hint from an upgrade request.
   * @param {Buffer} initialRequest - Initial HTTP request headers.
   * @returns {string | undefined} - Session identity, if present on a WebSocket upgrade.
   */
  websocketResumeSessionId(initialRequest) {
    const headerEnd = initialRequest.indexOf("\r\n\r\n")
    const fallbackHeaderEnd = headerEnd === -1 ? initialRequest.indexOf("\n\n") : headerEnd

    if (fallbackHeaderEnd === -1) return

    const lines = initialRequest.subarray(0, fallbackHeaderEnd).toString("latin1").split(/\r?\n/)
    const [method, requestTarget] = lines[0]?.split(" ") || []

    if (method !== "GET" || !requestTarget) return

    /** @type {Map<string, string>} */
    const headers = new Map()

    for (const line of lines.slice(1)) {
      const separatorIndex = line.indexOf(":")

      if (separatorIndex === -1) continue

      headers.set(line.slice(0, separatorIndex).trim().toLowerCase(), line.slice(separatorIndex + 1).trim().toLowerCase())
    }

    if (headers.get("upgrade") !== "websocket" || !headers.get("connection")?.split(",").map((value) => value.trim()).includes("upgrade")) return

    const sessionId = new URL(requestTarget, "http://velocious.invalid").searchParams.get(WEBSOCKET_SESSION_ROUTING_PARAMETER)

    return sessionId || undefined
  }

  /**
   * Records the live worker owner for a resumable session.
   * @param {{sessionId: string, workerHandler: WorkerHandler | InProcessHandler}} args - Ownership claim.
   * @returns {void}
   */
  claimWebsocketSession({sessionId, workerHandler}) {
    if (!this.workerHandlers.includes(workerHandler)) return
    this.websocketSessionOwners.set(sessionId, workerHandler)
  }

  /**
   * Releases a session only when the releasing worker still owns it.
   * @param {{sessionId: string, workerHandler: WorkerHandler | InProcessHandler}} args - Ownership release.
   * @returns {void}
   */
  releaseWebsocketSession({sessionId, workerHandler}) {
    if (this.websocketSessionOwners.get(sessionId) === workerHandler) this.websocketSessionOwners.delete(sessionId)
  }

  /**
   * Releases every session owned by a worker leaving service.
   * @param {WorkerHandler | InProcessHandler} workerHandler - Worker leaving service.
   * @returns {void}
   */
  releaseWebsocketSessionsForWorker(workerHandler) {
    for (const [sessionId, owner] of this.websocketSessionOwners) {
      if (owner === workerHandler) this.websocketSessionOwners.delete(sessionId)
    }
  }

  /**
   * On client close.
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

  /**
   * Runs spawn worker.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async spawnWorker() {
    const workerHandler = await this._buildWorkerHandler()

    this.workerHandlers.push(workerHandler)
  }

  /**
   * Runs build worker handlers.
   * @returns {Promise<Array<WorkerHandler | InProcessHandler>>} - Started worker handlers.
   */
  async _buildWorkerHandlers() {
    /**
     * Worker handlers.
     * @type {Array<WorkerHandler | InProcessHandler>} */
    const workerHandlers = []

    for (let index = 0; index < this.effectiveWorkers; index += 1) {
      workerHandlers.push(await this._buildWorkerHandler())
    }

    return workerHandlers
  }

  /**
   * Runs build worker handler.
   * @returns {Promise<WorkerHandler | InProcessHandler>} - Started worker handler.
   */
  async _buildWorkerHandler() {
    const workerCount = this.workerCount

    this.workerCount++

    const Handler = this.inProcess ? InProcessHandler : WorkerHandler
    const workerHandler = this.workerHandlerFactory
      ? this.workerHandlerFactory({
        configuration: this.configuration,
        onWebsocketSessionOwned: ({sessionId, workerHandler}) => this.claimWebsocketSession({sessionId, workerHandler}),
        onWebsocketSessionReleased: ({sessionId, workerHandler}) => this.releaseWebsocketSession({sessionId, workerHandler}),
        onWorkerStopped: ({workerHandler}) => this.releaseWebsocketSessionsForWorker(workerHandler),
        workerCount
      })
      : new Handler({
        configuration: this.configuration,
        onWebsocketSessionOwned: ({sessionId, workerHandler}) => this.claimWebsocketSession({sessionId, workerHandler}),
        onWebsocketSessionReleased: ({sessionId, workerHandler}) => this.releaseWebsocketSession({sessionId, workerHandler}),
        onWorkerStopped: ({workerHandler}) => this.releaseWebsocketSessionsForWorker(workerHandler),
        workerCount
      })

    await workerHandler.start()

    return workerHandler
  }

  /**
   * Runs worker handler to use.
   * @returns {WorkerHandler | InProcessHandler} - The worker handler to use.
   */
  workerHandlerToUse() {
    return this._nextRoundRobinWorkerHandler()
  }

  /**
   * Runs next round robin worker handler.
   * @returns {WorkerHandler | InProcessHandler} - The next round-robin worker handler.
   */
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

  /**
   * Runs should use development hot reload.
   * @returns {boolean} - Whether development worker hot reload should run.
   */
  shouldUseDevelopmentHotReload() {
    return !this.inProcess && this.configuration.getEnvironment() === "development"
  }

  /**
   * Runs start development reloader.
   * @returns {Promise<void>} - Resolves when watcher setup finishes.
   */
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

  /**
   * Runs reload workers for development.
   * @returns {Promise<void>} - Resolves when workers have been refreshed.
   */
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
        for (const workerHandler of oldWorkerHandlers) this.releaseWebsocketSessionsForWorker(workerHandler)

        await Promise.all(oldWorkerHandlers.map((workerHandler) => workerHandler.stop()))
      } while (this._reloadWorkersForDevelopmentQueued && !this._stopping)
    } finally {
      this._reloadingWorkersForDevelopment = false
    }
  }
}
