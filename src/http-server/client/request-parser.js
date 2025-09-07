import {digg} from "diggerize"
import {EventEmitter} from "events"
import Incorporator from "incorporator"
import ParamsToObject from "./params-to-object.js"
import RequestBuffer from "./request-buffer/index.js"

export default class VelociousHttpServerClientRequestParser {
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

  destroy() {
    this.requestBuffer.events.off("completed", this.requestDone)
    this.requestBuffer.events.off("form-data-part", this.onFormDataPart)
    this.requestBuffer.events.off("request-done", this.requestDone)
    this.requestBuffer.destroy()
  }

  onFormDataPart = (formDataPart) => {
    const unorderedParams = {}

    unorderedParams[formDataPart.getName()] = formDataPart.getValue()

    const paramsToObject = new ParamsToObject(unorderedParams)
    const newParams = paramsToObject.toObject()
    const incorporator = new Incorporator({objects: [this.params, newParams]})

    incorporator.merge()
  }

  feed = (data) => this.requestBuffer.feed(data)
  getHeader = (name) => this.requestBuffer.getHeader(name)?.value
  getHttpMethod = () => digg(this, "requestBuffer", "httpMethod")

  _getHostMatch = () => {
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

  getHost() {
    const rawHostSplit = this.requestBuffer.getHeader("host")?.value?.split(":")

    if (rawHostSplit && rawHostSplit[0]) return rawHostSplit[0]
  }

  getPath = () => digg(this, "requestBuffer", "path")

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

  getProtocol = () => this._getHostMatch()?.protocol

  requestDone = () => {
    const incorporator = new Incorporator({objects: [this.params, this.requestBuffer.params]})

    incorporator.merge()

    this.state = "done"
    this.events.emit("done")
  }
}
