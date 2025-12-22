// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import fetch from "node-fetch"
import Dummy from "../dummy/index.js"
import Header from "../../src/http-client/header.js"
import HttpClient from "../../src/http-client/index.js"
import {wait, waitFor} from "awaitery"

describe("HttpServer - get", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
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
        const response = await fetch("http://localhost:3006/api/doesnt-exist")
        const text = await response.text()

        expect(response.status).toEqual(404)
        expect(response.statusText).toEqual("Not Found")
        expect(text).toEqual("Path not found: /api/doesnt-exist\n")
      }
    })
  })

  it("supports HTTP 1.0 close connection", async () => {
    await Dummy.run(async () => {
      await wait(200)

      const httpClient = new HttpClient({
        debug: false,
        headers: [
          new Header("Connection", "Close")
        ],
        version: "1.0"
      })

      await httpClient.connect()

      const {response} = await httpClient.get("/ping")

      expect(response.json()).toEqual({message: "Pong"})
      expect(response.getHeader("Connection")?.value).toEqual("Close")

      await waitFor(() => {
        if (httpClient.isConnected()) throw new Error("HTTP client is still connected")
      })
    })
  })

  it("supports HTTP 1.0 keep-alive", async () => {
    await Dummy.run(async () => {
      await wait(200)

      const httpClient = new HttpClient({
        debug: false,
        headers: [
          new Header("Connection", "Keep-Alive")
        ],
        version: "1.0"
      })

      await httpClient.connect()

      for (let i = 0; i < 5; i++) {
        const {response} = await httpClient.get("/ping")

        expect(response.json()).toEqual({message: "Pong"})
        expect(response.getHeader("Connection")?.value).toEqual("Keep-Alive")
        await wait(100)
        expect(httpClient.isConnected()).toBeTrue()
      }

      await wait(500)
      expect(httpClient.isConnected()).toBeTrue()
    })
  })
})
