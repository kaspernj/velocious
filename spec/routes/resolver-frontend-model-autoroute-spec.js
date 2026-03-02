// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("routes - resolver frontend model autoroute", async () => {
  it("resolves frontend model commands from backendProjects resources without explicit routes", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resources: {
          FrontendModel: {
            attributes: ["id"],
            abilities: {
              find: "read",
              index: "read"
            },
            commands: {
              find: "frontend-find",
              index: "frontend-index"
            },
            path: "/frontend-models"
          }
        }
      }],
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

    const client = {remoteAddress: "127.0.0.1"}
    const request = new Request({client, configuration})
    const response = new Response({configuration})
    const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
    const requestLines = [
      "POST /frontend-models/frontend-index HTTP/1.1",
      "Host: example.com",
      "Content-Length: 0",
      "",
      ""
    ].join("\r\n")

    try {
      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})

      await resolver.resolve()
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }

    expect(JSON.parse(response.getBody())).toEqual({source: "frontend-autoroute", status: "success"})
  })

  it("resolves frontend model create command from backendProjects resources without explicit routes", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resources: {
          FrontendModel: {
            attributes: ["id"],
            abilities: {
              create: "create",
              find: "read",
              index: "read"
            },
            commands: {
              create: "frontend-create",
              find: "frontend-find",
              index: "frontend-index"
            },
            path: "/frontend-models"
          }
        }
      }],
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

    const client = {remoteAddress: "127.0.0.1"}
    const request = new Request({client, configuration})
    const response = new Response({configuration})
    const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
    const requestLines = [
      "POST /frontend-models/frontend-create HTTP/1.1",
      "Host: example.com",
      "Content-Length: 0",
      "",
      ""
    ].join("\r\n")

    try {
      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})

      await resolver.resolve()
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }

    expect(JSON.parse(response.getBody())).toEqual({source: "frontend-autoroute", status: "success"})
  })
})
