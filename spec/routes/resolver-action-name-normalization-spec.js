// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {Configuration} configuration - Configuration instance.
 * @param {string} requestLine - HTTP request line.
 * @returns {Promise<Record<string, any>>} - Parsed JSON response body.
 */
async function resolveAndParseJsonResponse(configuration, requestLine) {
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const response = new Response({configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const requestLines = [
    requestLine,
    "Host: example.com",
    "",
    ""
  ].join("\r\n")

  request.feed(Buffer.from(requestLines, "utf8"))
  await donePromise

  const resolver = new RoutesResolver({configuration, request, response})

  await resolver.resolve()

  return JSON.parse(response.getBody())
}

describe("routes - resolver action name normalization", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
  it("routes slash-delimited post route to controller path + action", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: true, file: false, levels: ["info", "warn", "error"]}
    })

    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }

    configuration.setCurrent()
    configuration.setRoutes(dummyRoutes.routes)

    try {
      const responseJson = await resolveAndParseJsonResponse(configuration, "POST /current-user/update HTTP/1.1")

      expect(responseJson).toEqual({message: "Current user updated"})
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })

  it("avoids partial post-prefix route matches when a longer sibling route exists", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: true, file: false, levels: ["info", "warn", "error"]}
    })

    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }

    configuration.setCurrent()
    configuration.setRoutes(dummyRoutes.routes)

    try {
      const responseJson = await resolveAndParseJsonResponse(configuration, "POST /current-user/update-password HTTP/1.1")

      expect(responseJson).toEqual({message: "Current user password updated"})
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })

  it("does not leak stale controller params between failed and successful get matches", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: true, file: false, levels: ["info", "warn", "error"]}
    })

    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }

    configuration.setCurrent()
    configuration.setRoutes(dummyRoutes.routes)

    try {
      const responseJson = await resolveAndParseJsonResponse(configuration, "GET /current-user/update/details HTTP/1.1")

      expect(responseJson).toEqual({message: "Current user update details"})
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })
})
