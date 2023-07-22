import {digg} from "diggerize"
import RequestParser from "./request-parser.mjs"

export default class VelociousHttpServerClientRequest {
  constructor({configuration}) {
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})
  }

  feed = (data) => this.requestParser.feed(data)
  httpMethod = () => digg(this, "requestParser", "httpMethod")
  host = () => digg(this, "requestParser", "headersByName", "host")
  path = () => digg(this, "requestParser", "path")
  params = () => digg(this, "requestParser", "params")
}
