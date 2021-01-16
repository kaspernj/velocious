module.exports = class VelociousHttpServerWorkerHandlerSocketHandler {
  constructor({socket, clientCount, worker}) {
    this.socket = socket
    this.clientCount = clientCount
    this.worker = worker

    socket.on("data", (chunk) => this.onSocketData(chunk))
    socket.on("end", () => this.onSocketEnd())
  }

  onSocketData(chunk) {
    console.log(`Socket ${this.clientCount}: ${chunk}`)

    this.worker.postMessage({
      command: "clientWrite",
      chunk,
      clientCount: this.clientCount
    })
  }

  onSocketEnd() {
    console.log(`Socket ${this.clientCount} end`)
  }
}
