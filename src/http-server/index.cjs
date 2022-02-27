const logger = require("../logger.cjs")
const Net = require("net")
const WorkerHandler = require("./worker-handler/index.cjs")

module.exports = class VelociousHttpServer {
  constructor({configuration, host, maxWorkers, port}) {
    this.configuration = configuration
    this.host = host || "0.0.0.0"
    this.port = port || 3006
    this.clientCount = 0
    this.maxWorkers = maxWorkers || 16
    this.workerCount = 0
    this.workerHandlers = []
  }

  async start() {
    await this._ensureAtLeastOneWorker()
    this.netServer = new Net.Server()
    this.netServer.on("connection", this.onConnection)
    await this._netServerListen()
  }

  _netServerListen() {
    return new Promise((resolve, reject) => {
      try {
        this.netServer.listen(this.port, this.host, () => {
          logger(this, `Velocious listening on ${this.host}:${this.port}`)
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

  stop() {
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

  onConnection = (socket) => {
    const clientCount = this.clientCount

    logger(this, `New client ${clientCount}`)

    this.clientCount++

    const workerHandler = this.workerHandlerToUse()

    logger(this, `Gave client ${clientCount} to worker ${workerHandler.workerCount}`)

    workerHandler.addSocketConnection({
      socket,
      clientCount: this.clientCount
    })
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
    logger(this, `Worker handlers length: ${this.workerHandlers.length}`)

    const randomWorkerNumber = parseInt(Math.random() * this.workerHandlers.length)
    const workerHandler = this.workerHandlers[randomWorkerNumber]

    if (!workerHandler) {
      throw new Error(`No workerHandler by that number: ${randomWorkerNumber}`)
    }

    return workerHandler
  }
}
