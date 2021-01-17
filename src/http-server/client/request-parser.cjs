const {EventEmitter} = require("events")

module.exports = class VelociousHttpServerClientRequestParser {
  constructor() {
    this.data = []
    this.events = new EventEmitter()
    this.headers = []
    this.headersByName = {}
    this.state = "status"
  }

  addHeader(name, value) {
    console.log("addHeader", {name, value})

    this.headers.push({name, value})

    const formattedName = name.toLowerCase().trim()

    this.headersByName[formattedName] = value
  }

  feed(data) {
    if (this.state == "status" || this.state == "headers") {
      for (const char of data) {
        this.data.push(char)

        if (char == 10) {
          const line = String.fromCharCode.apply(null, this.data)

          this.data = []
          this.parse(line)
        }
      }
    }
  }

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
        this.state = "done"
        this.events.emit("done")
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
}
