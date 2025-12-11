// @ts-check

import {digg} from "diggerize"
import RequestParser from "./request-parser.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousHttpServerClientRequest {
  /**
   * @param {object} args
   * @param {import("./index.js").default} args.client
   * @param {import("../../configuration.js").default} args.configuration
   */
  constructor({client, configuration, ...restArgs}) {
    restArgsError(restArgs)

    this.client = client
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})
  }

  baseURL() { return `${this.protocol()}://${this.hostWithPort()}` }

  /**
   * @param {Buffer} data
   * @returns {void}
   */
  feed(data) { return this.requestParser.feed(data) }

  /**
   * @param {string} headerName
   * @returns {string | null}
   */
  header(headerName) { return this.getRequestBuffer().getHeader(headerName)?.getValue() }
  headers() { return this.getRequestBuffer().getHeadersHash() }
  httpMethod() { return this.requestParser.getHttpMethod() }
  httpVersion() { return this.requestParser.getHttpVersion() }
  host() { return this.requestParser.getHost() }

  hostWithPort() {
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

  origin() { return this.header("origin") }
  path() { return this.requestParser.getPath() }
  params() { return digg(this, "requestParser", "params") }
  port() { return this.requestParser.getPort() }
  protocol() { return this.requestParser.getProtocol() }

  getRequestBuffer() { return this.getRequestParser().getRequestBuffer() }
  getRequestParser() { return this.requestParser }
}
