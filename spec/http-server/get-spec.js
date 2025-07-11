import fetch from "node-fetch"
import Dummy from "../dummy/index.js"

describe("HttpServer", () => {
  it("handles get requests", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/tasks")
      const text = await response.text()

      expect(text).toEqual("1, 2, 3, 4, 5\n")
    })
  })
})
