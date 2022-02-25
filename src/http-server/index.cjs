const logger = require("../logger.cjs")
const Net = require("net")
const WorkerHandler = require("./worker-handler/index.cjs")

module.exports = class VelociousHttpServer {
  constructor({configuration, host, maxWorkers, port}) {
    this.configuration = configuration
    this.host = host
    this.port = port
    this.clientCount = 0
    this.maxWorkers = maxWorkers || 16
    this.workerCount = 0
    this.workerHandlers = []
  }

  async start() {
    // We need at least one worker to handle requests
    if (this.workerHandlers.length == 0) {
      await this.spawnWorker()
    }

    this.netServer = new Net.Server()
    this.netServer.on("connection", this.onConnection)
    this.netServer.listen(this.port, () => {
      logger(this, `Velocious listening on ${this.host}:${this.port}`)
    })
  }

  stop() {
    return new Promise((resolve) => {
      this.netServer?.close(() => resolve())
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
