import fetch from "node-fetch"
import Dummy from "../dummy/index.js"

describe("HttpServer - get", () => {
  it("handles get requests", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/tasks")
        const text = await response.text()

        expect(response.status).toEqual(200)
        expect(response.statusText).toEqual("OK")
        expect(text).toEqual("1, 2, 3, 4, 5\n")
      }
    })
  })

  it("returns a 404 error when a collection action isnt found", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/tasks/doesnt-exist")
        const text = await response.text()

        expect(response.status).toEqual(404)
        expect(response.statusText).toEqual("Not Found")
        expect(text).toEqual("Path not found: /tasks/doesnt-exist\n")
      }
    })
  })
})
