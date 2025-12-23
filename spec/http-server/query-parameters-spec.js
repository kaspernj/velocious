// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fetch from "node-fetch"
import Dummy from "../dummy/index.js"

describe("HttpServer - query parameters", async () => {
  it("exposes query parameters via params() while keeping getParams() untouched", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/params?foo=bar&filters[name]=baz")
      const body = await response.text()

      /** @type {any} */
      const parsed = JSON.parse(body)

      expect(parsed.params).toEqual({
        action: "params",
        controller: "_root",
        foo: "bar",
        filters: {name: "baz"}
      })
      expect(parsed.getParams).toEqual({action: "params"})
      expect(parsed.queryParameters).toEqual({foo: "bar", filters: {name: "baz"}})
    })
  })
})
