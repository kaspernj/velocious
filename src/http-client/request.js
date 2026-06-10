// @ts-check

import Header from "./header.js"

export default class Request {
  /**
 * Runs constructor.
   * @param {object} args - Options object.
   * @param {string} [args.body] - Request body.
   * @param {string} args.method - HTTP method.
   * @param {Header[]} args.headers - Header list.
   * @param {string} args.path - Path.
   * @param {string} args.version - Version.
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
 * Runs get header.
   * @param {string} name - Name.
   * @returns {Header} - The header.
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
 * Runs add header.
   * @param {string} name - Name.
   * @param {string | number} value - Value to use.
   * @returns {void} - No return value.
   */
  addHeader(name, value) {
    this.headers.push(new Header(name, value))
  }

  /**
 * Runs prepare.
   * @returns {void} - No return value.
   */
  prepare() {
    if (this.body) {
      this.addHeader("Content-Length", Buffer.from(this.body).byteLength)
    }
  }

  /**
 * Runs stream.
   * @param {function(string) : void} callback - Callback function.
   * @returns {void} - No return value.
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
