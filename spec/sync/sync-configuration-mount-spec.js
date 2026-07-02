// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"

class TestSyncModel {}

class TestSyncResource extends FrontendModelBaseResource {
  static ModelClass = /** @type {?} */ (TestSyncModel)
}

/**
 * Builds a minimal configuration for sync mount tests.
 * @param {Record<string, ?>} [sync] - Sync configuration.
 * @returns {Configuration} Configuration instance.
 */
function buildConfiguration(sync) {
  return new Configuration({
    database: {test: {}},
    directory: "/tmp/velocious-sync-mount-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    locales: ["en"],
    sync
  })
}

/**
 * Resolves a route hook match for a request path.
 * @param {Configuration} configuration - Configuration with route hooks.
 * @param {string} currentPath - Request path.
 * @returns {Promise<Record<string, ?> | null>} Matched route or null.
 */
async function resolveRoute(configuration, currentPath) {
  const request = {httpMethod: () => "POST"}

  for (const hook of configuration.getRouteResolverHooks()) {
    const match = await hook({configuration, currentPath, request: /** @type {?} */ (request)})

    if (match) return match
  }

  return null
}

describe("sync configuration mount", () => {
  it("auto-mounts sync changes and replay routes when sync.api is configured", async () => {
    const configuration = buildConfiguration({api: {resourceClass: TestSyncResource}})

    await configuration.mountConfiguredSyncApi()

    const changesRoute = await resolveRoute(configuration, "/velocious/sync/changes")
    const replayRoute = await resolveRoute(configuration, "/velocious/sync/replay")

    expect(changesRoute?.action).toEqual("changes")
    expect(replayRoute?.action).toEqual("replay")
  })

  it("mounts sync routes at a configured mount path", async () => {
    const configuration = buildConfiguration({api: {mountPath: "/api/sync", resourceClass: TestSyncResource}})

    await configuration.mountConfiguredSyncApi()

    expect((await resolveRoute(configuration, "/api/sync/changes"))?.action).toEqual("changes")
    expect(await resolveRoute(configuration, "/velocious/sync/changes")).toEqual(null)
  })

  it("does not mount sync routes when sync.api is absent", async () => {
    const configuration = buildConfiguration()

    await configuration.mountConfiguredSyncApi()

    expect(await resolveRoute(configuration, "/velocious/sync/changes")).toEqual(null)
  })

  it("only mounts the sync routes once across repeated initializations", async () => {
    const configuration = buildConfiguration({api: {resourceClass: TestSyncResource}})

    await configuration.mountConfiguredSyncApi()

    const hookCountAfterFirstMount = configuration.getRouteResolverHooks().length

    await configuration.mountConfiguredSyncApi()

    expect(configuration.getRouteResolverHooks().length).toEqual(hookCountAfterFirstMount)
  })

  it("rejects an invalid sync.api.resourceClass at configuration time", async () => {
    await expect(() => buildConfiguration({api: {resourceClass: "SyncResource"}})).toThrow(/sync\.api\.resourceClass must be a resource class/u)
    await expect(() => buildConfiguration({api: {resourceClass: class {}}})).toThrow(/must define static ModelClass/u)
  })

  it("rejects an invalid sync.api.mountPath at configuration time", async () => {
    await expect(() => buildConfiguration({api: {mountPath: "velocious/sync", resourceClass: TestSyncResource}})).toThrow(/sync\.api\.mountPath must start with '\/'/u)
  })
})
