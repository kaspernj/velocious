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

/**
 * @param {net.Socket} socket - Socket.
 * @param {string} [initialBuffer] - Initial buffer.
 * @returns {Promise<{response: string, remaining: string}>} - Response payload.
 */
const readResponse = async (socket, initialBuffer = "") => {
  let buffer = initialBuffer
  let headerEndIndex = -1
  let contentLength = 0

  return await timeout({timeout: 2000}, async () => {
    return await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        buffer += chunk.toString("utf8")

        if (headerEndIndex === -1) {
          headerEndIndex = buffer.indexOf("\r\n\r\n")

          if (headerEndIndex !== -1) {
            const headerBlock = buffer.slice(0, headerEndIndex)
            const match = headerBlock.match(/Content-Length: (\d+)/i)

            if (match) contentLength = Number(match[1])
          }
        }

        if (headerEndIndex !== -1 && buffer.length >= headerEndIndex + 4 + contentLength) {
          const response = buffer.slice(0, headerEndIndex + 4 + contentLength)
          const remaining = buffer.slice(headerEndIndex + 4 + contentLength)

          socket.off("data", onData)
          resolve({response, remaining})
        }
      }

      socket.on("data", onData)
      socket.on("error", reject)
    })
  })
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

  it("supports HTTP 1.0 keep-alive", async () => {
    await Dummy.run(async () => {
      const socket = new net.Socket()
      let remaining = ""

      socket.connect(3006, "127.0.0.1", () => {
        socket.write([
          "GET /ping HTTP/1.0",
          "Host: localhost",
          "Connection: keep-alive",
          "",
          ""
        ].join("\r\n"))
      })

      try {
        const firstResponse = await readResponse(socket)
        remaining = firstResponse.remaining

        socket.write([
          "GET /ping HTTP/1.0",
          "Host: localhost",
          "Connection: close",
          "",
          ""
        ].join("\r\n"))

        const secondResponse = await readResponse(socket, remaining)
        const statusLines = [
          ...(firstResponse.response.match(/HTTP\/1\.0 200 OK/g) || []),
          ...(secondResponse.response.match(/HTTP\/1\.0 200 OK/g) || [])
        ]

        expect(statusLines.length).toBe(2)
      } finally {
        socket.destroy()
      }
    })
  })
})
