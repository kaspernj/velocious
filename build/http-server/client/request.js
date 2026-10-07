// @ts-check

import {digg} from "diggerize"
import querystring from "querystring"
import RequestParser from "./request-parser.js"
import resolveRemoteAddress from "../remote-address.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousHttpServerClientRequest {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("./index.js").default} args.client - Client instance.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   */
  constructor({client, configuration, ...restArgs}) {
    restArgsError(restArgs)

    this.client = client
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})

    /**
     * Whether the owning client connection was torn down while this request
     * was still running. Set once by the client on socket teardown and read
     * by handlers that need to settle in-flight work (e.g. admission queue
     * positions) without waiting for the response to be sent.
     * @type {boolean} */
    this.clientDisconnected = false

    /** @type {Set<() => void>} */
    this.clientDisconnectCallbacks = new Set()
  }

  baseURL() { return `${this.protocol()}://${this.hostWithPort()}` }

  /**
   * Runs feed.
   * @param {Buffer} data - Data payload.
   * @returns {Buffer | undefined} - Remaining data, if any.
   */
  feed(data) { return this.requestParser.feed(data) }

  /**
   * Runs header.
   * @param {string} headerName - Header name.
   * @returns {string | null} - The header.
   */
  header(headerName) { return this.getRequestBuffer().getHeader(headerName)?.getValue() }
  headers() { return this.getRequestBuffer().getHeadersHash() }
  httpMethod() { return this.requestParser.getHttpMethod() }
  httpVersion() { return this.requestParser.getHttpVersion() }
  host() { return this.requestParser.getHost() }
  /**
   * Runs metadata.
   * @param {string} [key] - Metadata key.
   * @returns {ReturnType<typeof JSON.parse>} - Metadata value for a key, or the full metadata object.
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
  /**
   * Runs params.
   * @returns {Record<string, string | string[] | undefined | Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>>} - The request params.
   */
  params() { return digg(this, "requestParser", "params") }
  port() { return this.requestParser.getPort() }

  /**
   * Runs query params.
   * @returns {Record<string, string | string[]>} - Parsed query parameters from the URL.
   */
  queryParams() {
    const query = this.path().split("?")[1]

    if (!query) return Object.create(null)

    const parsed = querystring.parse(query)
    /**
     * Params.
     * @type {Record<string, string | string[]>} */
    const params = Object.create(null)

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "undefined") {
        params[key] = value
      }
    }

    return params
  }
  protocol() { return this.requestParser.getProtocol() }
  remoteAddress() {
    return resolveRemoteAddress({
      configuration: this.configuration,
      headers: this.headers(),
      socketRemoteAddress: this.socketRemoteAddress()
    })
  }
  /**
   * Returns exact body bytes for requests whose header-stage body policy selected raw mode.
   * @returns {Buffer} - A copy of the exact request body bytes.
   */
  rawBody() { return this.getRequestBuffer().getRawBody() }
  socketRemoteAddress() { return this.client?.remoteAddress }

  /**
   * Marks this request as client-disconnected and runs every registered
   * disconnect callback exactly once. The owning client invokes it when the
   * socket tears down; handlers that register afterwards learn of the
   * disconnect through the `clientDisconnected` field instead.
   * @returns {void}
   */
  markClientDisconnected() {
    if (this.clientDisconnected) return
    this.clientDisconnected = true
    for (const callback of this.clientDisconnectCallbacks) {
      callback()
    }
    this.clientDisconnectCallbacks.clear()
  }

  /**
   * Registers a callback that fires once when the client connection tears
   * down while this request is still running. Buffered requests cannot rely
   * on the streaming response's `onStreamClose` for that: no stream has
   * been opened yet, so a queued request's queue position is otherwise
   * stranded until its admission deadline.
   * @param {() => void} callback - Disconnect callback.
   * @returns {void}
   */
  onClientDisconnect(callback) {
    if (this.clientDisconnected) {
      callback()
      return
    }
    this.clientDisconnectCallbacks.add(callback)
  }

  getRequestBuffer() { return this.getRequestParser().getRequestBuffer() }
  getRequestParser() { return this.requestParser }
}
