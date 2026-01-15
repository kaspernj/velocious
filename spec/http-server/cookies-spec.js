// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import Header from "../../src/http-client/header.js"
import HttpClient from "../../src/http-client/index.js"

const setCookieHeaders = (response) => {
  return response.headers.filter((header) => header.getName().toLowerCase() === "set-cookie")
}

const cookieHeaderValue = (headers) => {
  return headers.map((header) => String(header.getValue()).split(";")[0]).join("; ")
}

describe("HttpServer - cookies", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("sets and reads plain cookies", async () => {
    await Dummy.run(async () => {
      const httpClientSet = new HttpClient({debug: false})

      await httpClientSet.connect()

      const {response: setResponse} = await httpClientSet.get("/cookies/set")
      const setHeaders = setCookieHeaders(setResponse)
      const cookieHeader = cookieHeaderValue(setHeaders)

      expect(setHeaders.length).toBe(1)
      expect(setHeaders[0].getValue()).toMatch(/HttpOnly/)
      expect(setHeaders[0].getValue()).toMatch(/SameSite=Lax/)

      const httpClientRead = new HttpClient({debug: false})

      await httpClientRead.connect()

      const {response: readResponse} = await httpClientRead.get("/cookies/read", {
        headers: [new Header("Cookie", cookieHeader)]
      })

      const payload = readResponse.json()
      const cookie = payload.cookies.find((item) => item.name === "flavor")

      expect(cookie.value).toBe("chocolate")
      expect(cookie.encrypted).toBe(false)
      expect(cookie.error).toBe(undefined)
    })
  })

  it("decrypts encrypted cookies", async () => {
    await Dummy.run(async () => {
      const httpClientSet = new HttpClient({debug: false})

      await httpClientSet.connect()

      const {response: setResponse} = await httpClientSet.get("/cookies/set-encrypted")
      const setHeaders = setCookieHeaders(setResponse)
      const cookieHeader = cookieHeaderValue(setHeaders)

      expect(setHeaders.length).toBe(1)

      const httpClientRead = new HttpClient({debug: false})

      await httpClientRead.connect()

      const {response: readResponse} = await httpClientRead.get("/cookies/read", {
        headers: [new Header("Cookie", cookieHeader)]
      })

      const payload = readResponse.json()
      const cookie = payload.cookies.find((item) => item.name === "secret")

      expect(cookie.value).toBe("s3cr3t")
      expect(cookie.encrypted).toBe(true)
      expect(cookie.error).toBe(undefined)
    })
  })
})
