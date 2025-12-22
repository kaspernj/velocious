// @ts-check

import {digg} from "diggerize"
import {EventEmitter} from "events"
import {incorporate} from "incorporator"
import ParamsToObject from "./params-to-object.js"
import RequestBuffer from "./request-buffer/index.js"

export default class VelociousHttpServerClientRequestParser {
  /**
   * @param {object} args
   * @param {import("../../configuration.js").default} args.configuration
   */
  constructor({configuration}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.data = []
    this.events = new EventEmitter()
    this.params = {}

    this.requestBuffer = new RequestBuffer({configuration})
    this.requestBuffer.events.on("completed", this.requestDone)
    this.requestBuffer.events.on("form-data-part", this.onFormDataPart)
    this.requestBuffer.events.on("request-done", this.requestDone)
  }

  /** @returns {void} */
  destroy() {
    this.requestBuffer.events.off("completed", this.requestDone)
    this.requestBuffer.events.off("form-data-part", this.onFormDataPart)
    this.requestBuffer.events.off("request-done", this.requestDone)
    this.requestBuffer.destroy()
  }

  /**
   * @param {import("./request-buffer/form-data-part.js").default} formDataPart
   * @returns {void}
   */
  onFormDataPart = (formDataPart) => {
    /** @type {Record<string, string>} */
    const unorderedParams = {}

    unorderedParams[formDataPart.getName()] = formDataPart.getValue()

    const paramsToObject = new ParamsToObject(unorderedParams)
    const newParams = paramsToObject.toObject()

    incorporate(this.params, newParams)
  }

  /**
   * @param {Buffer} data
   * @returns {void}
   */
  feed = (data) => this.requestBuffer.feed(data)

  /**
   * @param {string} name
   * @returns {string}
   */
  getHeader(name) { return this.requestBuffer.getHeader(name)?.value }

  /** @returns {Record<string, string>} */
  getHeaders() { return this.requestBuffer.getHeadersHash() }

  /** @returns {string} */
  getHttpMethod() { return digg(this, "requestBuffer", "httpMethod") }

  /** @returns {string} */
  getHttpVersion() { return digg(this, "requestBuffer", "httpVersion") }

  /** @returns {{host: string, port: string, protocol: string} | null} */
  _getHostMatch() {
    const rawHost = this.requestBuffer.getHeader("origin")?.value

    if (!rawHost) return null

    const match = rawHost.match(/^(.+):\/\/(.+)(|:(\d+))/)

    if (!match) throw new Error(`Couldn't match host: ${rawHost}`)

    return {
      protocol: match[1],
      host: match[2],
      port: match[4]
    }
  }

  /** @returns {string | null} */
  getHost() {
    const rawHostSplit = this.requestBuffer.getHeader("host")?.value?.split(":")

    if (rawHostSplit && rawHostSplit[0]) return rawHostSplit[0]
  }

  /** @returns {string} */
  getPath() { return digg(this, "requestBuffer", "path") }

  /** @returns {number} */
  getPort() {
    const rawHostSplit = this.requestBuffer.getHeader("host")?.value?.split(":")
    const httpMethod = this.getHttpMethod()

    if (rawHostSplit && rawHostSplit[1]) {
      return parseInt(rawHostSplit[1])
    } else if (httpMethod == "http") {
      return 80
    } else if (httpMethod == "https") {
      return 443
    }
  }

  /** @returns {string | null} */
  getProtocol() { return this._getHostMatch()?.protocol }

  /** @returns {RequestBuffer} */
  getRequestBuffer() { return this.requestBuffer }

  /** @returns {void} */
  requestDone = () => {
    incorporate(this.params, this.requestBuffer.params)

    this.state = "done"
    this.events.emit("done")
  }
}
