// @ts-check

export default class FormDataPart {
  /** @type {Record<string, import("./header.js").default>} */
  headers = {}

  /** @type {number[]} */
  body = []

  /**
   * @param {import("./header.js").default} header
   */
  addHeader(header) {
    const name = header.formattedName

    this.headers[name] = header

    if (name == "content-disposition") {
      const match = header.value.match(/^form-data; name="(.+)"$/)

      if (match) {
        this.name = match[1]
      } else {
        console.error(`Couldn't match name from content-disposition: ${header.value}`)
      }
    } else if (name == "content-length") {
      this.contentLength = parseInt(header.value)
    }
  }

  finish() {
    this.value = String.fromCharCode.apply(null, this.body)
  }

  getName() {
    if (!this.name) throw new Error("Name hasn't been set")

    return this.name
  }

  getValue() {
    if (!this.value) throw new Error("Value hasn't been set")

    return this.value
  }

  /**
   * @param {string} text
   */
  removeFromBody(text) {
    this.body = this.body.slice(0, this.body.length - text.length)
  }
}
