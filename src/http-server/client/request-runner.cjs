const EventEmitter = require("events")
const Response = require("./response.cjs")

module.exports = class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()
  response = new Response()

  constructor(request) {
    this.request = request
  }

  run() {
    this.response.addHeader("Content-Type", "application/json")
    this.response.setBody(JSON.stringify({firstName: "Kasper"}))

    console.log("Run request :-)")

    this.events.emit("done", this)
  }
}
