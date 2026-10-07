// @ts-check

import querystring from "querystring"

export default class VelociousHttpServerClientWebsocketRequest {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {ReturnType<typeof JSON.parse>} [args.body] - Request body.
   * @param {Record<string, string>} [args.headers] - Header list.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.metadata] - Session metadata.
   * @param {string} args.method - HTTP method.
   * @param {string} args.path - Path.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.params] - Parameters object.
   * @param {string} [args.remoteAddress] - Remote address.
   */
  constructor({body, headers, metadata, method, params, path, remoteAddress}) {
    if (!method) throw new Error("method is required")
    if (!path) throw new Error("path is required")

    this.body = body
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string>} */
    this.headersMap = {}
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    this.metadataObject = metadata ? {...metadata} : {}
    this.method = method.toUpperCase()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    this.paramsObject = {}
    this._path = path
    this.remoteAddressValue = remoteAddress

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.headersMap[key.toLowerCase()] = value
      }
    }

    if (params) this.paramsObject = {...params}
    if (this.body && typeof this.body === "object") this.paramsObject = {...this.paramsObject, ...this.body}
    if (this.body && typeof this.body === "object" && !this.headersMap["content-type"]) {
      this.headersMap["content-type"] = "application/json"
    }

    const queryParams = this._parseQueryParams()

    this.paramsObject = {...queryParams, ...this.paramsObject}

    /**
     * Whether the owning client connection was torn down while this request
     * was still running. Websocket requests are session-owned and never
     * enter the client's in-flight request list, so this stays false for
     * them; the field exists so the request union shares one surface.
     * @type {boolean} */
    this.clientDisconnected = false

    /** @type {Set<() => void>} */
    this.clientDisconnectCallbacks = new Set()
  }

  /**
   * Marks this request as client-disconnected and runs every registered
   * disconnect callback exactly once. The owning client invokes it when the
   * socket tears down; handlers that register afterwards learn of the
   * disconnect through the `clientDisconnected` field instead. Websocket
   * requests are session-owned and never enter the client's in-flight
   * request list, so this is inert for them; the shared surface keeps the
   * request union uniform.
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
   * down while this request is still running. See the HTTP request's
   * {@linkcode markClientDisconnected} for the shared-surface note.
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

  baseURL() {
    const protocol = this.protocol()
    const host = this.hostWithPort()

    if (protocol && host) return `${protocol}://${host}`
  }

  /**
   * Runs header.
   * @param {string} name - Header name.
   * @returns {string | null} - Header value.
   */
  header(name) { return this.headersMap[name.toLowerCase()] || null }

  headers() { return this.headersMap }

  httpMethod() { return this.method }

  httpVersion() { return "websocket" }

  host() { return this.header("host") || undefined }

  /**
   * Runs metadata.
   * @param {string} [key] - Metadata key.
   * @returns {ReturnType<typeof JSON.parse>} - Metadata value for a key, or the full metadata object.
   */
  metadata(key) {
    if (key !== undefined) return this.metadataObject[key]

    return {...this.metadataObject}
  }

  hostWithPort() {
    const host = this.host()
    const port = this.port()

    if (!host) return
    if (!port) return host

    return `${host}:${port}`
  }

  origin() { return this.header("origin") }

  path() { return this._path }

  params() { return this.paramsObject }

  port() {
    const hostHeader = this.header("host")
    const match = hostHeader?.match(/:(\d+)$/)

    if (match) return parseInt(match[1])
  }

  protocol() {
    const origin = this.origin()
    const match = origin?.match(/^(.+):\/\//)

    return match?.[1]
  }

  /**
   * Runs query params.
   * @returns {Record<string, string | string[]>} - Parsed query parameters from the URL.
   */
  queryParams() { return this._parseQueryParams() }

  remoteAddress() { return this.remoteAddressValue }

  _parseQueryParams() {
    const query = this._path.split("?")[1]

    if (!query) return Object.create(null)

    const parsedQuery = querystring.parse(query)
    /**
     * Params.
     * @type {Record<string, string | string[]>} */
    const params = Object.create(null)

    for (const key of Object.keys(parsedQuery)) {
      const value = parsedQuery[key]

      if (typeof value !== "undefined") {
        params[key] = value
      }
    }

    return params
  }
}
