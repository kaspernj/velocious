const fetch = require("node-fetch")
const HttpServer = require("../../src/http-server/index.cjs")

describe("HttpServer", () => {
  it("handles get requests", async () => {
    const httpServer = new HttpServer({port: 3005})

    httpServer.start()

    const response = await fetch("http://localhost:3005")
  })
})
