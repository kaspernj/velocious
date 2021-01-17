const Application = require("../../src/application.cjs")
const fetch = require("node-fetch")
const path = require("path")

describe("HttpServer", () => {
  fit("handles get requests", async () => {
    const dummyDirectory = path.join(__dirname, "../../dummy")

    const application = new Application({
      directory: dummyDirectory,
      httpServer: {port: 3006}
    })
    await application.start()

    const response = await fetch("http://localhost:3006")
  })
})
