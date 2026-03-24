// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

class ClassBasedFrontendModelResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      commands: {
        find: "frontend-find",
        index: "frontend-index"
      },
      path: "/frontend-models"
    }
  }
}

class CreateFrontendModelResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        create: "create",
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      commands: {
        create: "frontend-create",
        find: "frontend-find",
        index: "frontend-index"
      },
      path: "/frontend-models"
    }
  }
}

class InvalidPathFrontendModelResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      commands: {
        find: "frontend-find",
        index: "frontend-index"
      },
      path: "/frontend-models;drop"
    }
  }
}

class InvalidCommandFrontendModelResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      commands: {
        find: "frontend-find",
        index: "frontend-index?raw=1"
      },
      path: "/frontend-models"
    }
  }
}

class EmptyCommandFrontendModelResource extends FrontendModelBaseResource {
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      commands: {
        find: "frontend-find",
        index: ""
      },
      path: "/frontend-models"
    }
  }
}

/**
 * @param {Record<string, {default?: unknown}>} modules - Modules keyed by require-context path.
 * @returns {{(id: string): {default?: unknown}, keys: () => string[]}} - Webpack-style require context.
 */
function buildRequireContext(modules) {
  /**
   * @param {string} id - Module id.
   * @returns {{default?: unknown}} - Imported module.
   */
  function requireContext(id) {
    const loadedModule = modules[id]

    if (!loadedModule) {
      throw new Error(`Missing module in require context: ${id}`)
    }

    return loadedModule
  }

  requireContext.keys = () => Object.keys(modules)

  return requireContext
}

describe("routes - resolver frontend model autoroute", async () => {
  it("resolves frontend model commands from backendProjects resources without explicit routes", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resources: {
          FrontendModel: ClassBasedFrontendModelResource
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

  it("resolves frontend model commands from backendProjects resource require contexts", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resourcesRequireContext: buildRequireContext({
          "./frontend-model.js": {default: ClassBasedFrontendModelResource},
          "./shared-access.js": {default: {not: "a resource"}}
        })
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
          FrontendModel: CreateFrontendModelResource
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

  it("raises on unsafe frontend model resource paths in backendProjects config", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resources: {
          FrontendModel: InvalidPathFrontendModelResource
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

      await expect(async () => {
        await resolver.resolve()
      }).toThrow(/Invalid frontend model resource path/)
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })

  it("raises on unsafe frontend model commands in backendProjects config", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resources: {
          FrontendModel: InvalidCommandFrontendModelResource
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

      await expect(async () => {
        await resolver.resolve()
      }).toThrow(/Invalid frontend model command/)
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })

  it("raises on empty frontend model commands in backendProjects config", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        resources: {
          FrontendModel: EmptyCommandFrontendModelResource
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

      await expect(async () => {
        await resolver.resolve()
      }).toThrow(/Invalid frontend model command/)
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  })
})
