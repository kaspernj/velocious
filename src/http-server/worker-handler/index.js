import {digs} from "diggerize"
import logger from "../../logger.mjs"
import SocketHandler from "./socket-handler.mjs"
import {Worker} from "worker_threads"

export default class VelociousHttpServerWorker {
  constructor({configuration, workerCount}) {
    this.configuration = configuration
    this.socketHandlers = {}
    this.workerCount = workerCount
  }

  async start() {
    return new Promise((resolve) => {
      const {debug, directory} = digs(this.configuration, "debug", "directory")

      this.onStartCallback = resolve
      this.worker = new Worker(`${__dirname}/worker-script.js`, {
        workerData: {
          debug,
          directory,
          workerCount: this.workerCount
        }
      })
      this.worker.on("error", this.onWorkerError)
      this.worker.on("exit", this.onWorkerExit)
      this.worker.on("message", this.onWorkerMessage)
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

  onWorkerError = (error) => {
    throw new Error(`Worker error: ${error}`)
  }

  onWorkerExit = (code) => {
    if (code !== 0) {
      throw new Error(`Client worker stopped with exit code ${code}`)
    }
  }

  onWorkerMessage = (data) => {
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
