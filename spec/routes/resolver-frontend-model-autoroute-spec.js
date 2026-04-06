// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import Task from "../dummy/src/models/task.js"
import {describe, expect, it} from "../../src/testing/test.js"

class ClassBasedFrontendModelResource extends FrontendModelBaseResource {
  static ModelClass = Task
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      builtInCollectionCommands: {
        index: "frontend-index"
      },
      builtInMemberCommands: {
        find: "frontend-find"
      }
    }
  }
}

class CreateFrontendModelResource extends FrontendModelBaseResource {
  static ModelClass = Task
  /** @returns {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        create: "create",
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      builtInCollectionCommands: {
        create: "frontend-create",
        index: "frontend-index"
      },
      builtInMemberCommands: {
        find: "frontend-find",
      }
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
      builtInCollectionCommands: {
        index: "frontend-index?raw=1"
      },
      builtInMemberCommands: {
        find: "frontend-find"
      }
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
      builtInCollectionCommands: {
        index: ""
      },
      builtInMemberCommands: {
        find: "frontend-find"
      }
    }
  }
}

/**
 * @param {string} path - Request path.
 * @returns {string} - Raw HTTP request lines.
 */
function requestLinesForPath(path) {
  return [
    `POST ${path} HTTP/1.1`,
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n")
}

describe("routes - resolver frontend model autoroute", async () => {
  it("resolves frontend model commands from backendProjects.frontendModels without explicit routes", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        frontendModels: {
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
    const requestLines = requestLinesForPath("/frontend-models/frontend-index")

    try {
      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})

      await resolver.resolve()
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }

    expect(response.statusCode).not.toEqual(404)
  })

  it("resolves frontend model create command from backendProjects.frontendModels without explicit routes", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        frontendModels: {
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
    const requestLines = requestLinesForPath("/frontend-models/frontend-create")

    try {
      request.feed(Buffer.from(requestLines, "utf8"))
      await donePromise

      const resolver = new RoutesResolver({configuration, request, response})

      await resolver.resolve()
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }

    expect(response.statusCode).not.toEqual(404)
  })

  it("raises on unsafe frontend model commands in backendProjects config", async () => {
    const configuration = new Configuration({
      backendProjects: [{
        path: "/tmp/backend",
        frontendModels: {
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
    const requestLines = requestLinesForPath("/frontend-models/frontend-index")

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
        frontendModels: {
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
    const requestLines = requestLinesForPath("/frontend-models/frontend-index")

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
