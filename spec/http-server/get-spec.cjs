const Application = require("../../src/application.cjs")
const fetch = require("node-fetch")
const path = require("path")

describe("HttpServer", () => {
  it("handles get requests", async () => {
    const dummyDirectory = path.join(__dirname, "../../dummy")

    const application = new Application({
      debug: false,
      directory: dummyDirectory,
      httpServer: {port: 3006}
    })
    await application.start()

    const response = await fetch("http://localhost:3006")
    const data = await response.json()

    expect(data).toEqual({firstName: "Kasper"})
  })
})
