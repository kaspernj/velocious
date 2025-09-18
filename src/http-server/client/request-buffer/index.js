import {EventEmitter} from "events"
import FormDataPart from "./form-data-part.js"
import Header from "./header.js"
import Incorporator from "incorporator"
import {Logger} from "../../../logger.js"
import ParamsToObject from "../params-to-object.js"
import querystring from "querystring"

export default class RequestBuffer {
  bodyLength = 0
  data = []
  events = new EventEmitter()
  headersByName = {}
  params = {}
  readingBody = false
  state = "status"

  constructor({configuration}) {
    this.configuration = configuration
    this.logger = new Logger(this, {debug: false})
  }

  feed(data) {
    for (const char of data) {
      if (this.readingBody) this.bodyLength += 1

      switch(this.state) {
        case "status":
        case "headers":
        case "multi-part-form-data":
        case "multi-part-form-data-header":
          this.data.push(char)

          if (char == 10) {
            const line = String.fromCharCode.apply(null, this.data)

            this.data = []
            this.parse(line)
          }

          break
        case "multi-part-form-data-body":
          const body = this.formDataPart.body

          body.push(char)

          const possibleBoundaryEndPosition = body.length - this.boundaryLineEnd.length
          const possibleBoundaryEndChars = body.slice(possibleBoundaryEndPosition, body.length)
          const possibleBoundaryEnd = String.fromCharCode.apply(null, possibleBoundaryEndChars)

          const possibleBoundaryNextPosition = body.length - this.boundaryLineNext.length
          const possibleBoundaryNextChars = body.slice(possibleBoundaryNextPosition, body.length)
          const possibleBoundaryNext = String.fromCharCode.apply(null, possibleBoundaryNextChars)

          if (possibleBoundaryEnd == this.boundaryLineEnd) {
            this.formDataPart.removeFromBody(possibleBoundaryEnd)
            this.formDataPartDone()
            this.completeRequest()
          } else if (possibleBoundaryNext == this.boundaryLineNext) {
            this.formDataPart.removeFromBody(possibleBoundaryNext)
            this.formDataPartDone()
            this.newFormDataPart()
          } else if (this.contentLength && this.bodyLength >= this.contentLength) {
            this.formDataPartDone()
            this.completeRequest()
          } else if (this.formDataPart.contentLength && this.bodyLength >= this.formDataPart.contentLength) {
            this.formDataPartDone()

            throw new Error("stub")
          }

          break
        case "post-body":
          this.postBodyChars[this.bodyLength - 1] = char

          if (this.contentLength && this.bodyLength >= this.contentLength) {
            this.postRequestDone()
          }

          break
        default:
          console.error(`Unknown state for request buffer: ${this.state}`)
      }
    }
  }

  getHeader(name) {
    const result = this.headersByName[name.toLowerCase().trim()]

    this.logger.debug(() => [`getHeader ${name}`, {result: result?.toString()}])

    return result
  }

  getHeadersHash() {
    const result = {}

    for (const headerFormattedName in this.headersByName) {
      const header = this.headersByName[headerFormattedName]

      result[header.getName()] = header.getValue()
    }

    return result
  }

  formDataPartDone() {
    const formDataPart = this.formDataPart

    this.formDataPart = undefined
    formDataPart.finish()

    this.events.emit("form-data-part", formDataPart)
  }

  isMultiPartyFormData() {
    return this.multiPartyFormData
  }

  newFormDataPart() {
    this.formDataPart = new FormDataPart()
    this.setState("multi-part-form-data-header")
  }

  parse(line) {
    if (this.state == "status") {
      this.parseStatusLine(line)
    } else if (this.state == "headers") {
      this.parseHeader(line)
    } else if (this.state == "multi-part-form-data") {
      if (line == this.boundaryLine) {
        this.newFormDataPart()
      } else if (line == "\r\n") {
        this.setState("done")
      } else {
        throw new Error(`Expected boundary line but didn't get it: ${line}`)
      }
    } else if (this.state == "multi-part-form-data-header") {
      const header = this.readHeaderFromLine(line)

      if (header) {
        this.formDataPart.addHeader(header)
        this.state == "multi-part-form-data"
      } else if (line == "\r\n") {
        this.setState("multi-part-form-data-body")
      }
    } else {
      throw new Error(`Unknown state parsing line: ${this.state}`)
    }
  }

  readHeaderFromLine(line) {
    let match

    if (match = line.match(/^(.+): (.+)\r\n/)) {
      const header = new Header(match[1], match[2])

      return header
    }
  }

  addHeader(header) {
    const formattedName = header.getFormattedName()

    this.headersByName[formattedName] = header

    if (formattedName == "content-length") this.contentLength = parseInt(header.getValue())
  }

  parseHeader(line) {
    const header = this.readHeaderFromLine(line)

    if (header) {
      this.logger.debug(() => [`Parsed header: ${header.toString()}`])
      this.addHeader(header)
      this.events.emit("header", header)
    } else if (line == "\r\n") {
      if (this.httpMethod.toUpperCase() == "GET" || this.httpMethod.toUpperCase() == "OPTIONS") {
        this.completeRequest()
      } else if (this.httpMethod.toUpperCase() == "POST") {
        this.readingBody = true
        this.bodyLength = 0

        const match = this.getHeader("content-type")?.value?.match(/^multipart\/form-data;\s*boundary=(.+)$/i)

        if (match) {
          this.boundary = match[1]
          this.boundaryLine = `--${this.boundary}\r\n`
          this.boundaryLineNext = `\r\n--${this.boundary}\r\n`
          this.boundaryLineEnd = `\r\n--${this.boundary}--`
          this.multiPartyFormData = true
          this.setState("multi-part-form-data")
        } else {
          if (this.contentLength === 0) {
            this.completeRequest()
          } else if (!this.contentLength) {
            throw new Error("Content length hasn't been set")
          } else {
            this.postBodyBuffer = new ArrayBuffer(this.contentLength)
            this.postBodyChars = new Uint8Array(this.postBodyBuffer)

            this.setState("post-body")
          }
        }
      } else {
        throw new Error(`Unknown HTTP method: ${this.httpMethod}`)
      }
    }
  }

  parseStatusLine(line) {
    const match = line.match(/^(GET|OPTIONS|POST) (.+?) HTTP\/(.+)\r\n/)

    if (!match) {
      throw new Error(`Couldn't match status line from: ${line}`)
    }

    this.httpMethod = match[1]
    this.httpVersion = match[3]
    this.path = match[2]
    this.setState("headers")
    this.logger.debug(() => ["Parsed status line", {httpMethod: this.httpMethod, httpVersion: this.httpVersion, path: this.path}])
  }

  postRequestDone() {
    this.postBody = String.fromCharCode.apply(null, this.postBodyChars)

    delete this.postBodyChars
    delete this.postBodyBuffer

    this.parseQueryStringPostParams()
    this.completeRequest()
  }

  setState(newState) {
    this.logger.debug(() => [`Changing state from ${this.state} to ${newState}`])
    this.state = newState
  }

  completeRequest = () => {
    this.state = "status" // Reset state to new request

    if (this.getHeader("content-type")?.value?.startsWith("application/json")) {
      this.parseApplicationJsonParams()
    } else if (this.multiPartyFormData) {
      // Done after each new form data part
    }

    this.events.emit("completed")
  }

  parseApplicationJsonParams() {
    const newParams = JSON.parse(this.postBody)
    const incorporator = new Incorporator({objects: [this.params, newParams]})

    incorporator.merge()
  }

  parseQueryStringPostParams() {
    const unparsedParams = querystring.parse(this.postBody)
    const paramsToObject = new ParamsToObject(unparsedParams)
    const newParams = paramsToObject.toObject()
    const incorporator = new Incorporator({objects: [this.params, newParams]})

    incorporator.merge()
  }
}
