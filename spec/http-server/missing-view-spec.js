// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fetch from "node-fetch"
import Dummy from "../dummy/index.js"

describe("HttpServer - missing view", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("returns a 500 when a view file is missing", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/missing-view")
        const text = await response.text()

        expect(response.status).toEqual(500)
        expect(response.statusText).toEqual("Internal server error")
        expect(text).toContain("Missing view file:")
        expect(text).toContain("missing-view.ejs")
      }
    })
  })
})
