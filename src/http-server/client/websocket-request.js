// @ts-check

import querystring from "querystring"

export default class VelociousHttpServerClientWebsocketRequest {
  /**
   * @param {object} args - Options object.
   * @param {any} [args.body] - Request body.
   * @param {Record<string, string>} [args.headers] - Header list.
   * @param {string} args.method - HTTP method.
   * @param {string} args.path - Path.
   * @param {Record<string, any>} [args.params] - Parameters object.
   * @param {string} [args.remoteAddress] - Remote address.
   */
  constructor({body, headers, method, params, path, remoteAddress}) {
    if (!method) throw new Error("method is required")
    if (!path) throw new Error("path is required")

    this.body = body
    /** @type {Record<string, string>} */
    this.headersMap = {}
    this.method = method.toUpperCase()
    /** @type {Record<string, any>} */
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
  }

  baseURL() {
    const protocol = this.protocol()
    const host = this.hostWithPort()

    if (protocol && host) return `${protocol}://${host}`
  }

  /**
   * @param {string} name - Header name.
   * @returns {string | null} - Header value.
   */
  header(name) { return this.headersMap[name.toLowerCase()] || null }

  headers() { return this.headersMap }

  httpMethod() { return this.method }

  httpVersion() { return "websocket" }

  host() { return this.header("host") || undefined }

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

  /** @returns {Record<string, string | string[]>} - Parsed query parameters from the URL. */
  queryParams() { return this._parseQueryParams() }

  remoteAddress() { return this.remoteAddressValue }

  _parseQueryParams() {
    const query = this._path.split("?")[1]

    if (!query) return Object.create(null)

    const parsedQuery = querystring.parse(query)
    /** @type {Record<string, string | string[]>} */
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
