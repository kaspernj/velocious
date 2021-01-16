const ClientThread = require("./client-thread.cjs")
const Net = require("net")
const { Worker } = require("worker_threads")

module.exports = class VelociousHttpServer {
  constructor({host, maxWorkers, port}) {
    this.host = host
    this.port = port
    this.clientThreads = []
    this.maxWorkers = maxWorkers || 16
  }

  start() {
    this.netServer = new Net.Server()

    this.netServer.on("connection", (socket) => {
      const worker = new Worker("./client-worker.cjs")
      const clientThread = new ClientThread({socket, worker})

      this.clientThreads.push(clientThread)
    })

    this.netServer.listen(this.port, () => {
      console.log(`Velocious listening on ${this.host}:${this.port}`)
    })
  }
}
