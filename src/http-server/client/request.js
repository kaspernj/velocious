// @ts-check

import {digg} from "diggerize"
import querystring from "querystring"
import RequestParser from "./request-parser.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousHttpServerClientRequest {
  /**
   * @param {object} args - Options object.
   * @param {import("./index.js").default} args.client - Client instance.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   */
  constructor({client, configuration, ...restArgs}) {
    restArgsError(restArgs)

    this.client = client
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})
  }

  baseURL() { return `${this.protocol()}://${this.hostWithPort()}` }

  /**
   * @param {Buffer} data - Data payload.
   * @returns {Buffer | undefined} - Remaining data, if any.
   */
  feed(data) { return this.requestParser.feed(data) }

  /**
   * @param {string} headerName - Header name.
   * @returns {string | null} - The header.
   */
  header(headerName) { return this.getRequestBuffer().getHeader(headerName)?.getValue() }
  headers() { return this.getRequestBuffer().getHeadersHash() }
  httpMethod() { return this.requestParser.getHttpMethod() }
  httpVersion() { return this.requestParser.getHttpVersion() }
  host() { return this.requestParser.getHost() }
  /**
   * @param {string} [key] - Metadata key.
   * @returns {any} - Metadata value for a key, or the full metadata object.
   */
  metadata(key) {
    if (key !== undefined) return undefined

    return {}
  }

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
  /** @returns {Record<string, string | string[] | undefined | Record<string, unknown> | unknown[]>} - The request params. */
  params() { return digg(this, "requestParser", "params") }
  port() { return this.requestParser.getPort() }

  /** @returns {Record<string, string | string[]>} - Parsed query parameters from the URL. */
  queryParams() {
    const query = this.path().split("?")[1]

    if (!query) return Object.create(null)

    const parsed = querystring.parse(query)
    /** @type {Record<string, string | string[]>} */
    const params = Object.create(null)

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "undefined") {
        params[key] = value
      }
    }

    return params
  }
  protocol() { return this.requestParser.getProtocol() }
  remoteAddress() { return this.client?.remoteAddress }

  getRequestBuffer() { return this.getRequestParser().getRequestBuffer() }
  getRequestParser() { return this.requestParser }
}
