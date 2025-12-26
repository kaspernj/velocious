// @ts-check

import Header from "./header.js"

export default class Request {
  /**
   * @param {object} args
   * @param {string} [args.body]
   * @param {string} args.method
   * @param {Header[]} args.headers
   * @param {string} args.path
   * @param {string} args.version
   */
  constructor({body, method = "GET", headers = [], path, version = "1.1"}) {
    this.body = body
    this.headers = headers
    this.method = method
    this.path = path
    this.version = version
  }

  asString() {
    let requestString = ""

    this.stream((chunk) => {
      requestString += chunk
    })

    return requestString
  }

  /**
   * @param {string} name
   * @returns {Header} - Result.
   */
  getHeader(name) {
    const compareName = name.toLowerCase().trim()

    for (const header of this.headers) {
      const headerCompareName = header.getName().toLowerCase().trim()

      if (compareName == headerCompareName) {
        return header
      }
    }

    throw new Error(`Header ${name} not found`)
  }

  /**
   * @param {string} name
   * @param {string | number} value
   * @returns {void} - Result.
   */
  addHeader(name, value) {
    this.headers.push(new Header(name, value))
  }

  /**
   * @returns {void} - Result.
   */
  prepare() {
    if (this.body) {
      this.addHeader("Content-Length", Buffer.from(this.body).byteLength)
    }
  }

  /**
   * @param {function(string) : void} callback
   * @returns {void} - Result.
   */
  stream(callback) {
    this.prepare()

    const requestString = `${this.method} ${this.path} HTTP/${this.version}\r\n`

    callback(requestString)

    for (const header of this.headers) {
      callback(`${header.toString()}\r\n`)
    }

    callback(`\r\n`)

    if (this.body) {
      callback(this.body)
    }
  }
}
