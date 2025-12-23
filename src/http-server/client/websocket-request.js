// @ts-check

import querystring from "querystring"

export default class VelociousHttpServerClientWebsocketRequest {
  /**
   * @param {object} args
   * @param {any} [args.body]
   * @param {Record<string, string>} [args.headers]
   * @param {string} args.method
   * @param {string} args.path
   * @param {Record<string, any>} [args.params]
   * @param {string} [args.remoteAddress]
   */
  constructor({body, headers, method, params, path, remoteAddress}) {
    if (!method) throw new Error("method is required")
    if (!path) throw new Error("path is required")

    this.body = body
    this.headersMap = {}
    this.method = method.toUpperCase()
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

  remoteAddress() { return this.remoteAddressValue }

  _parseQueryParams() {
    const query = this._path.split("?")[1]

    if (!query) return {}

    /** @type {Record<string, any>} */
    const unparsedParams = querystring.parse(query)
    /** @type {Record<string, any>} */
    const params = {}

    for (const key of Object.keys(unparsedParams)) {
      params[key] = unparsedParams[key]
    }

    return params
  }
}
