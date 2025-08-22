import {digg} from "diggerize"
import EventEmitter from "events"
import {Logger} from "../logger.js"
import Net from "net"
import ServerClient from "./server-client.js"
import WorkerHandler from "./worker-handler/index.js"

export default class VelociousHttpServer {
  clientCount = 0
  clients = {}
  events = new EventEmitter()
  workerCount = 0
  workerHandlers = []

  constructor({configuration, host, maxWorkers, port}) {
    this.configuration = configuration
    this.logger = new Logger(this)
    this.host = host || "0.0.0.0"
    this.port = port || 3006
    this.maxWorkers = maxWorkers || 16
  }

  async start() {
    await this._ensureAtLeastOneWorker()
    this.netServer = new Net.Server()
    this.netServer.on("close", this.onClose)
    this.netServer.on("connection", this.onConnection)
    await this._netServerListen()
  }

  _netServerListen() {
    return new Promise((resolve, reject) => {
      try {
        this.netServer.listen(this.port, this.host, () => {
          this.logger.debug(`Velocious listening on ${this.host}:${this.port}`)
          resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  async _ensureAtLeastOneWorker() {
    if (this.workerHandlers.length == 0) {
      await this.spawnWorker()
    }
  }

  isActive() {
    return this.netServer.listening
  }

  async stopClients() {
    for (const clientCount in this.clients) {
      const client = this.clients[clientCount]

      await client.close()
    }
  }

  stopServer() {
    return new Promise((resolve, reject) => {
      this.netServer.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  async stop() {
    await this.stopClients()
    await this.stopServer()
  }

  onClose = () => {
    this.events.emit("close")
  }

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

  onClientClose = (client) => {
    const clientCount = digg(client, "clientCount")
    const oldClientsLength = Object.keys(this.clients).length

    delete this.clients[clientCount]

    const newClientsLength = Object.keys(this.clients).length

    if (newClientsLength != (oldClientsLength - 1)) {
      console.error(`Expected client to have been removed but length didn't change from ${oldClientsLength} to ${oldClientsLength - 1}`)
    }
  }

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

  workerHandlerToUse() {
    this.logger.debug(`Worker handlers length: ${this.workerHandlers.length}`)

    const randomWorkerNumber = parseInt(Math.random() * this.workerHandlers.length)
    const workerHandler = this.workerHandlers[randomWorkerNumber]

    if (!workerHandler) {
      throw new Error(`No workerHandler by that number: ${randomWorkerNumber}`)
    }

    return workerHandler
  }
}
