import {describe, it} from "../../src/testing/test.js"
import fetch from "node-fetch"
import Dummy from "../dummy/index.js"

describe("HttpServer - root get", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("handles root get requests", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/ping")
        const text = await response.text()

        expect(response.status).toEqual(200)
        expect(response.statusText).toEqual("OK")
        expect(text).toEqual("{\"message\":\"Pong\"}")
      }
    })
  })

  it("returns a 404 error when a root get isn't found", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/doesnt-exist")
        const text = await response.text()

        expect(response.status).toEqual(404)
        expect(response.statusText).toEqual("Not Found")
        expect(text).toEqual("Path not found: /doesnt-exist\n")
      }
    })
  })
})
