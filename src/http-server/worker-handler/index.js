import {digg, digs} from "diggerize"
import {dirname} from "path"
import {fileURLToPath} from "url"
import {Logger} from "../../logger.js"
import {Worker} from "worker_threads"

export default class VelociousHttpServerWorker {
  constructor({configuration, workerCount}) {
    this.configuration = configuration
    this.clients = {}
    this.logger = new Logger(this)
    this.workerCount = workerCount
  }

  async start() {
    return new Promise((resolve) => {
      const {debug} = digs(this.configuration, "debug")
      const directory = this.configuration.getDirectory()
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)

      this.onStartCallback = resolve
      this.worker = new Worker(`${__dirname}/worker-script.js`, {
        workerData: {
          debug,
          directory,
          environment: this.configuration.getEnvironment(),
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
      this.logger.debug(`Removing ${clientCount} from clients`)
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
    } else {
      this.logger.debug(() => [`Client worker stopped with exit code ${code}`])
    }
  }

  onWorkerMessage = (data) => {
    this.logger.debug(`Worker message`, data)

    const {command} = digs(data, "command")

    if (command == "started") {
      this.onStartCallback()
      this.onStartCallback = null
    } else if (command == "clientOutput") {
      this.logger.debug("CLIENT OUTPUT", data)

      const {clientCount, output} = digs(data, "clientCount", "output")

      this.clients[clientCount]?.send(output)
    } else if (command == "clientClose") {
      const {clientCount} = digs(data, "clientCount")

      this.clients[clientCount]?.end()
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
