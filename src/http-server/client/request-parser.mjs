import {EventEmitter} from "events"
import logger from "../../logger.mjs"
import ParamsToObject from "./params-to-object.mjs"
import querystring from "querystring"

export default class VelociousHttpServerClientRequestParser {
  constructor({configuration}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.data = []
    this.events = new EventEmitter()
    this.headers = []
    this.headersByName = {}
    this.params = {}
    this.postBody = ""
    this.postBodyChars = []
    this.state = "status"
  }

  addHeader(name, value) {
    logger(this, "addHeader", {name, value})

    this.headers.push({name, value})

    const formattedName = name.toLowerCase().trim()

    this.headersByName[formattedName] = value
  }

  feed(data) {
    for (const char of data) {
      this.data.push(char)

      if (this.state == "status" || this.state == "headers") {
        if (char == 10) {
          const line = String.fromCharCode.apply(null, this.data)

          this.data = []
          this.parse(line)
        }
      } else if (this.state == "post-body") {
        this.postBodyChars.push(char)
      }
    }

    this.postBody += String.fromCharCode.apply(null, this.postBodyChars)

    if (this.contentLength && this.postBody.length >= this.contentLength) {
      this.postRequestDone()
    }
  }

  getHeader = (name) => this.headersByName[name.toLowerCase().trim()]

  matchAndRemove(regex) {
    const match = this.data.match(regex)

    if (!match) {
      return null
    }

    this.data = this.data.replace(regex, "")

    return match
  }

  parse(line) {
    if (this.state == "status") {
      this.parseStatusLine(line)
    } else if (this.state == "headers") {
      this.parseHeader(line)
    } else {
      throw new Error(`Unknown state: ${this.state}`)
    }
  }

  parseHeader(line) {
    let match

    if (match = line.match(/^(.+): (.+)\r\n/)) {
      const name = match[1]
      const value = match[2]

      this.addHeader(name, value)
    } else if (line == "\r\n") {
      if (this.httpMethod.toUpperCase() == "GET") {
        this.requestDone()
      } else if (this.httpMethod.toUpperCase() == "POST") {
        const contentLength = this.getHeader("Content-Length")

        if (contentLength) this.contentLength = parseInt(contentLength)

        this.state = "post-body"
      } else {
        throw new Error(`Unknown HTTP method: ${this.httpMethod}`)
      }
    }
  }

  parseStatusLine(line) {
    const match = line.match(/^(GET|POST) (.+?) HTTP\/1\.1\r\n/)

    if (!match) {
      throw new Error(`Couldn't match status line from: ${line}`)
    }

    this.httpMethod = match[1]
    this.path = match[2]
    this.state = "headers"
  }

  postRequestDone() {
    const unparsedParams = querystring.parse(this.postBody)
    const paramsToObject = new ParamsToObject(unparsedParams)
    const newParams = paramsToObject.toObject()

    Object.assign(this.params, newParams)

    this.requestDone()
  }

  requestDone() {
    this.state = "done"
    this.events.emit("done")
  }
}
