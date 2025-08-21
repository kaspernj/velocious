import {digg} from "diggerize"
import RequestParser from "./request-parser.js"

export default class VelociousHttpServerClientRequest {
  constructor({configuration}) {
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})
  }

  baseURL = () => `${this.protocol()}://${this.hostWithPort()}`
  feed = (data) => this.requestParser.feed(data)
  header = (headerName) => this.requestParser.requestBuffer.getHeader(headerName)?.value
  httpMethod = () => this.requestParser.getHttpMethod()
  host = () => this.requestParser.getHost()

  hostWithPort = () => {
    const port = this.port()
    const protocol = this.protocol()
    let hostWithPort = `${this.host()}`

    if (port == 80 && protocol == "http") {
      // Do nothing
    } else if (port == 443 && protocol == "https") {
      // Do nothing
    } else if (port) {
      hostWithPort += `:${port}`
    }

    return hostWithPort
  }

  origin = () => this.header("origin")
  path = () => this.requestParser.getPath()
  params = () => digg(this, "requestParser", "params")
  port = () => this.requestParser.getPort()
  protocol = () => this.requestParser.getProtocol()
}
