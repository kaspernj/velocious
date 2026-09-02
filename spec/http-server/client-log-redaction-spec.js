// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import HttpServerClient from "../../src/http-server/client/index.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("HTTP client transport log redaction", () => {
  it("does not expose request query, header, or body credentials before the request runner", async () => {
    const querySecret = "SYNQ6993"
    const headerSecret = "SYNH6993"
    const bodySecret = "SYNB6993"
    const output = new LoggerArrayOutput()
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {outputs: [{levels: ["debug"], output}]}
    })

    configuration.setRoutes(dummyRoutes.routes)

    const client = new HttpServerClient({clientCount: 7, configuration, remoteAddress: "127.0.0.1"})
    const body = JSON.stringify({serviceToken: bodySecret})
    const requestBytes = Buffer.from([
      `GET /ping?api-key=${querySecret}&safe=ok HTTP/1.1`,
      `Authorization: Bearer ${headerSecret}`,
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body
    ].join("\r\n"), "utf8")

    client.onWrite(requestBytes)

    const runner = client.requestRunners[0]

    if (!runner) throw new Error("Expected the parsed request to start a request runner")
    if (runner.getState() !== "done") await new Promise((resolve) => runner.events.once("done", resolve))

    const messages = output
      .getLogs()
      .filter((entry) => entry.subject === "VeoliciousHttpServerClient")
      .map((entry) => entry.message)

    const leakedValueCounts = {
      body: messages.filter((message) => message.includes(bodySecret)).length,
      header: messages.filter((message) => message.includes(headerSecret)).length,
      query: messages.filter((message) => message.includes(querySecret)).length
    }

    expect(leakedValueCounts).toEqual({body: 0, header: 0, query: 0})
    expect(messages.filter((message) => message.includes("[REDACTED]")).length).toBeGreaterThan(0)
    expect(messages.filter((message) => message.includes("safe=ok")).length).toBeGreaterThan(0)
    expect(messages.filter((message) => message.includes('"length"')).length).toBeGreaterThan(0)
    expect(messages.filter((message) => message.includes('"httpVersion":"1.1"')).length).toBeGreaterThan(0)
  })
})
