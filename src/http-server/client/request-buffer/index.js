// @ts-check

import {EventEmitter} from "events"
import FormDataPart from "./form-data-part.js"
import Header from "./header.js"
import {incorporate} from "incorporator"
import {Logger} from "../../../logger.js"
import ParamsToObject from "../params-to-object.js"
import querystring from "querystring"

export default class RequestBuffer {
  bodyLength = 0

  /** @type {number[]} */
  data = []

  events = new EventEmitter()

  /** @type {Record<string, Header>} */
  headersByName = {}

  multiPartyFormData = false

  params = {}
  readingBody = false
  state = "status"

  /**
   * @param {object} args
   * @param {import("../../../configuration.js").default} args.configuration
   */
  constructor({configuration}) {
    this.configuration = configuration
    this.logger = new Logger(this, {debug: false})
  }

  destroy() {
    // Do nothing for now...
  }

  /**
   * @param {Buffer} data
   * @returns {void} - Result.
   */
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
          if (!this.formDataPart) throw new Error("FormData part not initialized")
          if (!this.boundaryLineEnd) throw new Error("Boundary line end not initialized")
          if (!this.boundaryLineNext) throw new Error("Boundary line next not initialized")

          const body = this.formDataPart.body // eslint-disable-line no-case-declarations

          body.push(char)

          const possibleBoundaryEndPosition = body.length - this.boundaryLineEnd.length // eslint-disable-line no-case-declarations
          const possibleBoundaryEndChars = body.slice(possibleBoundaryEndPosition, body.length) // eslint-disable-line no-case-declarations
          const possibleBoundaryEnd = String.fromCharCode.apply(null, possibleBoundaryEndChars) // eslint-disable-line no-case-declarations

          const possibleBoundaryNextPosition = body.length - this.boundaryLineNext.length // eslint-disable-line no-case-declarations
          const possibleBoundaryNextChars = body.slice(possibleBoundaryNextPosition, body.length) // eslint-disable-line no-case-declarations
          const possibleBoundaryNext = String.fromCharCode.apply(null, possibleBoundaryNextChars) // eslint-disable-line no-case-declarations

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
          if (!this.postBodyChars) throw new Error("postBodyChars not initialized")

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

  /**
   * @param {string} name
   * @returns {Header} - Result.
   */
  getHeader(name) {
    const result = this.headersByName[name.toLowerCase().trim()]

    this.logger.debugLowLevel(() => [`getHeader ${name}`, {result: result?.toString()}])

    return result
  }

  /**
   * @returns {Record<string, string>} - Result.
   */
  getHeadersHash() {
    /** @type {Record<string, string>} */
    const result = {}

    for (const headerFormattedName in this.headersByName) {
      const header = this.headersByName[headerFormattedName]

      result[header.getName()] = header.getValue()
    }

    return result
  }

  /**
   * @returns {void} - Result.
   */
  formDataPartDone() {
    const formDataPart = this.formDataPart

    if (!formDataPart) throw new Error("formDataPart wasnt set")

    this.formDataPart = undefined
    formDataPart.finish()

    this.events.emit("form-data-part", formDataPart)
  }

  isMultiPartyFormData() {
    return this.multiPartyFormData
  }

  /**
   * @returns {void} - Result.
   */
  newFormDataPart() {
    this.formDataPart = new FormDataPart()
    this.setState("multi-part-form-data-header")
  }

  /**
   * @param {string} line
   * @returns {void} - Result.
   */
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
        if (!this.formDataPart) throw new Error("formDataPart not set")

        this.formDataPart.addHeader(header)
        //this.state == "multi-part-form-data"
      } else if (line == "\r\n") {
        this.setState("multi-part-form-data-body")
      }
    } else {
      throw new Error(`Unknown state parsing line: ${this.state}`)
    }
  }

  /**
   * @param {string} line
   * @returns {Header | undefined} - Result.
   */
  readHeaderFromLine(line) {
    const match = line.match(/^(.+): (.+)\r\n/)

    if (match) {
      const header = new Header(match[1], match[2])

      return header
    }
  }

  /**
   * @param {Header} header
   */
  addHeader(header) {
    const formattedName = header.getFormattedName()

    this.headersByName[formattedName] = header

    if (formattedName == "content-length") this.contentLength = parseInt(header.getValue())
  }

  /**
   * @param {string} line
   * @returns {void} - Result.
   */
  parseHeader(line) {
    const header = this.readHeaderFromLine(line)

    if (header) {
      this.logger.debugLowLevel(() => `Parsed header: ${header.toString()}`)
      this.addHeader(header)
      this.events.emit("header", header)
    } else if (line == "\r\n") {
      if (this.httpMethod?.toUpperCase() == "GET" || this.httpMethod?.toUpperCase() == "OPTIONS") {
        this.completeRequest()
      } else if (this.httpMethod?.toUpperCase() == "POST") {
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
            /** @type {number[]} */
            this.postBodyChars = []

            // this.postBodyBuffer = new ArrayBuffer(this.contentLength)
            // this.postBodyChars = new Uint8Array(this.postBodyBuffer)

            this.setState("post-body")
          }
        }
      } else {
        throw new Error(`Unknown HTTP method: ${this.httpMethod}`)
      }
    }
  }

  /**
   * @param {string} line
   * @returns {void} - Result.
   */
  parseStatusLine(line) {
    const match = line.match(/^(GET|OPTIONS|POST) (.+?) HTTP\/(.+)\r\n/)

    if (!match) {
      throw new Error(`Couldn't match status line from: ${line}`)
    }

    this.httpMethod = match[1]
    this.httpVersion = match[3]
    this.path = match[2]
    this.setState("headers")
    this.logger.debugLowLevel(() => ["Parsed status line", {httpMethod: this.httpMethod, httpVersion: this.httpVersion, path: this.path}])
  }

  postRequestDone() {
    if (this.postBodyChars) {
      this.postBody = String.fromCharCode.apply(null, this.postBodyChars)
    }

    delete this.postBodyChars
    // delete this.postBodyBuffer

    this.completeRequest()
  }

  /**
   * @param {string} newState
   * @returns {void} - Result.
   */
  setState(newState) {
    this.logger.debugLowLevel(() => `Changing state from ${this.state} to ${newState}`)
    this.state = newState
  }

  completeRequest = () => {
    this.state = "status" // Reset state to new request

    if (this.getHeader("content-type")?.value?.startsWith("application/json")) {
      this.parseApplicationJsonParams()
    } else if (this.multiPartyFormData) {
      // Done after each new form data part
    } else {
      this.parseQueryStringPostParams()
    }

    this.events.emit("completed")
  }

  parseApplicationJsonParams() {
    if (this.postBody) {
      const newParams = JSON.parse(this.postBody)

      incorporate(this.params, newParams)
    }
  }

  parseQueryStringPostParams() {
    if (this.postBody) {
      /** @type {Record<string, any>} */
      const unparsedParams = querystring.parse(this.postBody)
      const paramsToObject = new ParamsToObject(unparsedParams)
      const newParams = paramsToObject.toObject()

      incorporate(this.params, newParams)
    }
  }
}
