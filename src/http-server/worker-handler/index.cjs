const {digs} = require("diggerize")
const logger = require("../../logger.cjs")
const SocketHandler = require("./socket-handler.cjs")
const {Worker} = require("worker_threads")

module.exports = class VelociousHttpServerWorker {
  constructor({configuration, workerCount}) {
    this.configuration = configuration
    this.socketHandlers = {}
    this.workerCount = workerCount
  }

  async start() {
    return new Promise((resolve) => {
      const {debug, directory} = digs(this.configuration, "debug", "directory")

      this.onStartCallback = resolve
      this.worker = new Worker("./src/http-server/worker-handler/worker-script.cjs", {
        workerData: {
          debug,
          directory,
          workerCount: this.workerCount
        }
      })
      this.worker.on("error", (error) => this.onWorkerError(error))
      this.worker.on("exit", (code) => this.onWorkerExit(code))
      this.worker.on("message", (message) => this.onWorkerMessage(message))
    })
  }

  addSocketConnection({socket, clientCount}) {
    socket.on("end", () => {
      logger(this, `Removing ${clientCount} from socketHandlers`)
      delete this.socketHandlers[clientCount]
    })

    const socketHandler = new SocketHandler({
      configuration: this.configuration,
      socket,
      clientCount,
      worker: this.worker
    })

    this.socketHandlers[clientCount] = socketHandler
    this.worker.postMessage({command: "newClient", clientCount})
  }

  onWorkerError(error) {
    throw new Error(`Worker error: ${error}`)
  }

  onWorkerExit(code) {
    if (code !== 0) {
      throw new Error(`Client worker stopped with exit code ${code}`)
    }
  }

  onWorkerMessage(data) {
    logger(this, `Worker message`, data)

    const {command} = digs(data, "command")

    if (command == "started") {
      this.onStartCallback()
      this.onStartCallback = null
    } else if (command == "clientOutput") {
      logger(this, "CLIENT OUTPUT", data)

      const {clientCount, output} = digs(data, "clientCount", "output")

      logger(this, "CLIENT OUTPUT", data)

      this.socketHandlers[clientCount].send(output)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
