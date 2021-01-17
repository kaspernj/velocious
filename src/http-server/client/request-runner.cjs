const Response = require("./response.cjs")

module.exports = class VelociousHttpServerClientRequestRunner {
  constructor(request) {
    this.request = request
    this.response = new Response()
  }

  run() {
    this.response.addHeader("Content-Type", "application/json")
    this.response.setBody(JSON.stringify({firstName: "Kasper"}))

    console.log("Run request :-)")
  }
}
