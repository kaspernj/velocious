import {digg} from "diggerize"
import RequestParser from "./request-parser.js"

export default class VelociousHttpServerClientRequest {
  constructor({configuration}) {
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})
  }

  feed = (data) => this.requestParser.feed(data)
  httpMethod = () => this.requestParser.getHttpMethod()
  host = () => this.requestParser.getHost()
  path = () => this.requestParser.getPath()
  params = () => digg(this, "requestParser", "params")
}
