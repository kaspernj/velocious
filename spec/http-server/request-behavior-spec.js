// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import net from "net"
import timeout from "awaitery/build/timeout.js"

/**
 * @param {string} payload - Request payload.
 * @returns {Promise<string>} - Response payload.
 */
const sendRawRequest = async (payload) => {
  const socket = new net.Socket()
  let response = ""

  const responsePromise = new Promise((resolve, reject) => {
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8")
    })
    socket.on("end", () => resolve(response))
    socket.on("error", reject)
  })

  socket.connect(3006, "127.0.0.1", () => {
    socket.write(payload)
  })

  try {
    await timeout({timeout: 2000}, async () => {
      response = await responsePromise
    })
  } finally {
    socket.destroy()
  }

  return response
}

describe("HttpServer - request behavior", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("closes HTTP/1.1 connections when requested", async () => {
    await Dummy.run(async () => {
      const response = await sendRawRequest([
        "GET /ping HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "",
        ""
      ].join("\r\n"))

      expect(response).toContain("HTTP/1.1 200 OK")
      expect(response).toContain("Pong")
    })
  })

  it("handles chunked request bodies", async () => {
    await Dummy.run(async () => {
      const body = [
        "12\r\n",
        "task[name]=Chunked\r\n",
        "0\r\n",
        "\r\n"
      ].join("")
      const response = await sendRawRequest([
        "POST /tasks/collection-post HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/x-www-form-urlencoded",
        "Transfer-Encoding: chunked",
        "",
        body
      ].join("\r\n"))

      expect(response).toContain("HTTP/1.1 200 OK")
      expect(response).toContain("\"method\":\"post\"")
    })
  })

  it("responds to non-POST methods without hanging", async () => {
    await Dummy.run(async () => {
      const response = await sendRawRequest([
        "PUT /ping HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Length: 0",
        "",
        ""
      ].join("\r\n"))

      expect(response).toContain("HTTP/1.1")
    })
  })
})
