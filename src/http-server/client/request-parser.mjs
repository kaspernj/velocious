import {digg} from "diggerize"
import {EventEmitter} from "events"
import Incorporator from "incorporator"
import ParamsToObject from "./params-to-object.mjs"
import RequestBuffer from "./request-buffer/index.mjs"

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
  getHost = () => this.requestBuffer.getHeader("host")?.value
  getPath = () => digg(this, "requestBuffer", "path")

  requestDone = () => {
    const incorporator = new Incorporator({objects: [this.params, this.requestBuffer.params]})

    incorporator.merge()
    this.state = "done"
    this.events.emit("done")
  }
}
