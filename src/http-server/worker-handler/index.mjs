import {digg, digs} from "diggerize"
import {dirname} from "path"
import {fileURLToPath} from "url"
import logger from "../../logger.mjs"
import {Worker} from "worker_threads"

export default class VelociousHttpServerWorker {
  constructor({configuration, workerCount}) {
    this.configuration = configuration
    this.clients = {}
    this.workerCount = workerCount
  }

  async start() {
    return new Promise((resolve) => {
      const {debug, directory} = digs(this.configuration, "debug", "directory")
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)

      this.onStartCallback = resolve
      this.worker = new Worker(`${__dirname}/worker-script.mjs`, {
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

  addSocketConnection(client) {
    const clientCount = digg(client, "clientCount")

    client.socket.on("end", () => {
      logger(this, `Removing ${clientCount} from clients`)
      delete this.clients[clientCount]
    })

    client.worker = this.worker
    client.listen()

    this.clients[clientCount] = client
    this.worker.postMessage({command: "newClient", clientCount})
  }

  onWorkerError = (error) => {
    throw error // Throws original error with backtrace and everything into the console
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

      this.clients[clientCount].send(output)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
