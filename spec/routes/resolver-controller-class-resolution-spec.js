// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @returns {Configuration} - Minimal configuration for resolver tests.
 */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: true, file: false, levels: ["info", "warn", "error"]}
  })
}

/**
 * @param {Configuration} configuration - Configuration.
 * @returns {RoutesResolver} - Resolver instance.
 */
function buildResolver(configuration) {
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const response = new Response({configuration})

  return new RoutesResolver({configuration, request, response})
}

describe("routes - resolver controller class resolution", () => {
  it("falls back to route hook controller class when local controller file is missing", async () => {
    const configuration = buildConfiguration()
    const resolver = buildResolver(configuration)

    resolver.routeHookControllerClass = FrontendModelController

    const resolvedControllerClass = await resolver.resolveControllerClass({
      controllerPath: `${os.tmpdir()}/does-not-exist/controller.js`
    })

    expect(resolvedControllerClass).toBe(FrontendModelController)
  })

  it("raises when local controller import fails because a nested dependency is missing", async () => {
    const configuration = buildConfiguration()
    const resolver = buildResolver(configuration)
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-resolver-controller-class-"))
    const controllerPath = path.join(tempDirectory, "controller.js")

    try {
      await fs.writeFile(controllerPath, "import \"./missing-dependency.js\"\nexport default class MissingDependencyController {}\n", "utf8")

      resolver.routeHookControllerClass = FrontendModelController

      await expect(async () => {
        await resolver.resolveControllerClass({controllerPath})
      }).toThrow(/Cannot find module/)
    } finally {
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })
})
