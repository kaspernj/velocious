// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fetch from "node-fetch"

import Dummy from "../dummy/index.js"

describe("HttpServer - namespace", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("handles post requests", async () => {
    await Dummy.run(async () => {
      const response = await fetch(
        "http://localhost:3006/api/version",
        {method: "POST"}
      )
      const data = /** @type {Record<string, any>} */ (await response.json())

      expect(data.version).toEqual("2.1")
    })
  })
})
