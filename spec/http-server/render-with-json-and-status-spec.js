// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fetch from "node-fetch"
import Dummy from "../dummy/index.js"

describe("Controller#render with json + status", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("ships the requested HTTP status code alongside the JSON body", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/ping-with-status")
      const json = await response.json()

      expect(response.status).toEqual(422)
      expect(response.statusText).toEqual("Unprocessable Entity")
      expect(json).toEqual({message: "Rejected", status: "error"})
    })
  })

  it("suppresses the body and Content-Length for no-body status codes (204)", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/ping-no-body")
      const text = await response.text()

      expect(response.status).toEqual(204)
      expect(response.statusText).toEqual("No Content")
      expect(text).toEqual("")
      // Content-Length must NOT be present per RFC 7230 §3.3.3 so
      // keep-alive clients do not wait for bytes that will not arrive.
      expect(response.headers.get("content-length")).toEqual(null)
    })
  })
})
