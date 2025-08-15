export default class RequestClient {
  host = "localhost"
  port = 31006

  get() {
    throw new Error("get stub")
  }

  async post(path) {
    const response = await fetch(`http://${this.host}:${this.port}${path}`, {method: "POST", signal: AbortSignal.timeout(5000)})

    console.log({response})

    throw new Error("post stub")
  }
}
