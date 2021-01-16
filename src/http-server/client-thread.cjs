module.exports = class VelociousHttpServerClientThread {
  constructor({socket, worker}) {
    this.socket = socket
    this.worker = worker

    worker.on("error", () => this.onWorkerError())
    worker.on("exit", (code) => this.onWorkerExit(code))
    worker.on("message", (message) => this.onWorkerMessage(message))
  }

  onWorkerError() {
    throw new Error(`Worker error`)
  }

  onWorkerExit(code) {
    if (code !== 0) {
      throw new Error(`Client worker stopped with exit code ${code}`)
    }
  }

  onWorkerMessage(message) {
    console.log(`Worker message: ${message}`)
  }
}
