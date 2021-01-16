const {digs} = require("@kaspernj/object-digger")
const SocketHandler = require("./socket-handler.cjs")
const {Worker} = require("worker_threads")

module.exports = class VelociousHttpServerWorker {
  constructor({workerCount}) {
    this.socketHandlers = {}
    this.workerCount = workerCount
  }

  async start() {
    return new Promise((resolve) => {
      this.onStartCallback = resolve
      this.worker = new Worker("./src/http-server/worker-handler/worker-script.cjs", {
        workerData: {
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
      console.log(`Removing ${clientCount} from socketHandlers`)
      delete this.socketHandlers[clientCount]
    })

    const socketHandler = new SocketHandler({
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
    console.log(`Worker message`, data)

    const {command} = digs(data, "command")

    if (command == "started") {
      this.onStartCallback()
      this.onStartCallback = null
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
