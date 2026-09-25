// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import net from "net"
import {readRawHttpResponse, sendRawHttpRequest} from "../helpers/raw-http-test-client.js"

describe("HttpServer - request behavior", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  /** @returns {number} - Number of HTTP controller action checkouts currently in use. */
  const activeControllerActionConnectionCount = () => {
    const defaultPool = dummyConfiguration.getDatabasePool("default")
    const snapshot = defaultPool.getDebugSnapshot()

    return snapshot.connections.filter((connection) => connection.state === "in-use" && connection.checkoutName === "RootController.ping").length
  }

  it("closes HTTP/1.1 connections when requested", async () => {
    await Dummy.run(async () => {
      const response = await sendRawHttpRequest([
        "GET /ping HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "",
        ""
      ].join("\r\n"))

      expect(response.toString("utf8")).toContain("HTTP/1.1 200 OK")
      expect(response.toString("utf8")).toContain("Pong")
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
      const response = await sendRawHttpRequest([
        "POST /tasks/collection-post HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/x-www-form-urlencoded",
        "Transfer-Encoding: chunked",
        "",
        body
      ].join("\r\n"))

      expect(response.toString("utf8")).toContain("HTTP/1.1 200 OK")
      expect(response.toString("utf8")).toContain("\"method\":\"post\"")
    })
  })

  it("responds with bad request on malformed nested post parameter keys", async () => {
    await Dummy.run(async () => {
      const body = "task[]]=Broken"
      const response = await sendRawHttpRequest([
        "POST /tasks/collection-post HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/x-www-form-urlencoded",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body
      ].join("\r\n"))

      expect(response.toString("utf8")).toContain("HTTP/1.1 400 Bad Request")
    })
  })

  it("responds to non-POST methods without hanging", async () => {
    await Dummy.run(async () => {
      const response = await sendRawHttpRequest([
        "PUT /ping HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Length: 0",
        "",
        ""
      ].join("\r\n"))

      expect(response.toString("utf8")).toContain("HTTP/1.1")
    })
  })

  it("responds with bad request on invalid status lines", async () => {
    await Dummy.run(async () => {
      const invalidResponse = await sendRawHttpRequest("GET /\n")

      expect(invalidResponse.toString("utf8")).toContain("HTTP/1.1 400 Bad Request")

      const validResponse = await sendRawHttpRequest([
        "GET /ping HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "",
        ""
      ].join("\r\n"))

      expect(validResponse.toString("utf8")).toContain("HTTP/1.1 200 OK")
    })
  })

  it("does not crash when a malformed request follows a valid request", async () => {
    await Dummy.run(async () => {
      const response = await sendRawHttpRequest([
        "GET /ping HTTP/1.1",
        "Host: localhost",
        "",
        "",
        "GET /\n"
      ].join("\r\n"))

      expect(response.toString("utf8")).toContain("HTTP/1.1 400 Bad Request")

      const followUpResponse = await sendRawHttpRequest([
        "GET /ping HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "",
        ""
      ].join("\r\n"))

      expect(followUpResponse.toString("utf8")).toContain("HTTP/1.1 200 OK")
    })
  })

  it("supports HTTP 1.0 keep-alive", async () => {
    await Dummy.run(async () => {
      const socket = new net.Socket()

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
        const firstResponse = await readRawHttpResponse(socket)
        const remaining = firstResponse.remaining

        socket.write([
          "GET /ping HTTP/1.0",
          "Host: localhost",
          "Connection: close",
          "",
          ""
        ].join("\r\n"))

        const secondResponse = await readRawHttpResponse(socket, remaining)
        const statusLines = [
          ...(firstResponse.response.toString("latin1").match(/HTTP\/1\.0 200 OK/g) || []),
          ...(secondResponse.response.toString("latin1").match(/HTTP\/1\.0 200 OK/g) || [])
        ]

        expect(statusLines.length).toBe(2)
      } finally {
        socket.destroy()
      }
    })
  })

  it("checks database connections back in between keep-alive requests", async () => {
    await Dummy.run(async () => {
      const socket = new net.Socket()

      socket.connect(3006, "127.0.0.1", () => {
        socket.write([
          "GET /ping HTTP/1.1",
          "Host: localhost",
          "Connection: keep-alive",
          "",
          ""
        ].join("\r\n"))
      })

      try {
        const firstResponse = await readRawHttpResponse(socket)

        expect(firstResponse.response.toString("utf8")).toContain("HTTP/1.1 200 OK")
        expect(activeControllerActionConnectionCount()).toBe(0)

        socket.write([
          "GET /ping HTTP/1.1",
          "Host: localhost",
          "Connection: close",
          "",
          ""
        ].join("\r\n"))

        const secondResponse = await readRawHttpResponse(socket, firstResponse.remaining)

        expect(secondResponse.response.toString("utf8")).toContain("HTTP/1.1 200 OK")
        expect(activeControllerActionConnectionCount()).toBe(0)
      } finally {
        socket.destroy()
      }
    })
  })
})
