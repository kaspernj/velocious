// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import Routes from "../../src/routes/index.js"
import RoutesResolver from "../../src/routes/resolver.js"
import Task from "../dummy/src/models/task.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("routes - resolver hooks", async () => {
  it("allows custom hooks to hijack unresolved routes", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: true, file: false, levels: ["info", "warn", "error"]},
      routeResolverHooks: [({currentPath}) => {
        if (currentPath !== "/special-route") return null

        return {action: "index", controller: "hijacked"}
      }]
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
      "GET /special-route HTTP/1.1",
      "Host: example.com",
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

    expect(JSON.parse(response.getBody())).toEqual({source: "custom-hook", status: "success"})
  })

  it("allows custom hooks to hijack routes before regular route matching", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: true, file: false, levels: ["info", "warn", "error"]},
      routeResolverHooks: [({currentPath}) => {
        if (currentPath !== "/tasks") return null

        return {action: "index", controller: "hijacked"}
      }]
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
      "GET /tasks HTTP/1.1",
      "Host: example.com",
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

    expect(JSON.parse(response.getBody())).toEqual({source: "custom-hook", status: "success"})
  })

  it("does not let the frontend model hook shadow custom routes with the same path prefix", async () => {
    class TaskFrontendResource extends FrontendModelBaseResource {
      static ModelClass = Task

      /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          builtInCollectionCommands: ["index"],
          builtInMemberCommands: ["find"]
        }
      }
    }

    const routes = new Routes()

    routes.draw((route) => {
      route.get("tasks/index")
    })

    const configuration = new Configuration({
      backendProjects: [{
        frontendModels: {Task: TaskFrontendResource},
        frontendModelsOutputPath: "/tmp",
        path: dummyDirectory()
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
    configuration.setRoutes(routes)

    const client = {remoteAddress: "127.0.0.1"}
    const request = new Request({client, configuration})
    const response = new Response({configuration})
    const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
    const requestLines = [
      "GET /tasks/index HTTP/1.1",
      "Host: example.com",
      "",
      ""
    ].join("\r\n")

    try {
      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})
      const params = resolver.params

      // Resolve will fail to load the controller file (it doesn't exist in the dummy app),
      // but that's fine — we just need to verify the route was matched correctly.
      try {
        await resolver.resolve()
      } catch {
        // Expected: controller file not found
      }

      // The custom route should have been matched, setting action to "index".
      // If the frontend model hook had intercepted it, the action would be
      // "frontend-index" (the hook prefixes actions with "frontend-").
      expect(params.controller).toEqual("tasks")
      expect(params.action).toEqual("index")
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })
})
