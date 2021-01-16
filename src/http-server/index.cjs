const Net = require("net")
const WorkerHandler = require("./worker-handler/index.cjs")

module.exports = class VelociousHttpServer {
  constructor({host, maxWorkers, port}) {
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

    this.netServer.on("connection", (socket) => this.onConnection(socket))

    this.netServer.listen(this.port, () => {
      console.log(`Velocious listening on ${this.host}:${this.port}`)
    })
  }

  onConnection(socket) {
    const clientCount = this.clientCount

    console.log(`New client ${clientCount}`)

    this.clientCount++

    const workerHandler = this.workerHandlerToUse()

    console.log(`Gave client ${clientCount} to worker ${workerHandler.workerCount}`)

    workerHandler.addSocketConnection({
      socket,
      clientCount: this.clientCount
    })
  }

  async spawnWorker() {
    const workerCount = this.workerCount

    this.workerCount++

    const workerHandler = new WorkerHandler({workerCount})

    await workerHandler.start()
    this.workerHandlers.push(workerHandler)
  }

  workerHandlerToUse() {
    console.log(`Worker handlers length: ${this.workerHandlers.length}`)

    const randomWorkerNumber = parseInt(Math.random() * this.workerHandlers.length)
    const workerHandler = this.workerHandlers[randomWorkerNumber]

    if (!workerHandler) {
      throw new Error(`No workerHandler by that number: ${randomWorkerNumber}`)
    }

    return workerHandler
  }
}
