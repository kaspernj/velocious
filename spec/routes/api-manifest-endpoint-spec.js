// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import RoutesResolver from "../../src/routes/resolver.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import {describe, expect, it} from "../../src/testing/test.js"

class TestUserResource extends FrontendModelBaseResource {
  static attributes = ["id", "email", "name", "createdAt"]

  static abilities = ["approve"]

  static builtInCollectionCommands = ["index", "create"]

  static builtInMemberCommands = ["find", "update"]

  static collectionCommands = [
    "refreshAll",
    {name: "searchByEmail", args: [{name: "email", type: "string"}], returnType: "{found: boolean}"}
  ]

  static memberCommands = [{name: "suspend", returnType: "{success: boolean}"}]

  static relationships = ["account"]
}

class TestResourceResource extends FrontendModelBaseResource {
  static attributes = ["id", "name"]
}

class TestRenamedResource extends FrontendModelBaseResource {
  static attributes = ["id", "title"]

  static modelName = "PublicName"

  static memberCommands = ["archive"]
}

/**
 * @param {object} args - Configuration arguments.
 * @param {import("../../src/configuration-types.js").AbilityResolverType} [args.abilityResolver] - Optional ability resolver.
 * @param {boolean | {path?: string, token?: string}} [args.apiManifest] - API manifest configuration.
 * @param {import("../../src/configuration-types.js").TenantResolverType} [args.tenantResolver] - Optional tenant resolver.
 * @returns {Configuration} - Test configuration.
 */
function buildConfiguration({abilityResolver, apiManifest = false, tenantResolver} = {}) {
  return new Configuration({
    abilityResolver,
    apiManifest,
    backendProjects: [{
      frontendModels: {
        InternalName: TestRenamedResource,
        Resource: TestResourceResource,
        User: TestUserResource
      },
      path: "/tmp/backend"
    }],
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          name: "test-db",
          poolType: SingleMultiUsePool,
          type: "sqlite"
        }
      }
    },
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: true, file: false, levels: ["info", "warn", "error"]},
    tenantResolver
  })
}

/**
 * @param {Configuration} configuration - Configuration instance.
 * @param {string} path - Request path.
 * @param {{authorization?: string}} [options] - Optional request headers.
 * @returns {Promise<Response>} - Response after route resolution.
 */
async function resolveGet(configuration, path, {authorization} = {}) {
  const previousConfiguration = currentConfigurationOrUndefined()
  configuration.setCurrent()
  configuration.setRoutes(dummyRoutes.routes)

  const response = new Response({configuration})
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const authorizationHeaderLine = authorization ? `Authorization: ${authorization}\r\n` : ""

  try {
    request.feed(Buffer.from(`GET ${path} HTTP/1.1\r\nHost: example.com\r\n${authorizationHeaderLine}\r\n`, "utf8"))
    await donePromise

    const resolver = new RoutesResolver({configuration, request, response})
    await resolver.resolve()
  } finally {
    await configuration.closeDatabaseConnections()

    if (previousConfiguration) previousConfiguration.setCurrent()
  }

  return response
}

/** @returns {Configuration | undefined} - Current configuration when one has been set. */
function currentConfigurationOrUndefined() {
  try {
    return Configuration.current()
  } catch {
    return
  }
}

describe("routes - api manifest endpoint", () => {
  it("is disabled by default", async () => {
    const response = await resolveGet(buildConfiguration(), "/api/manifest")

    expect(response.getStatusCode()).toEqual(404)
  })

  it("returns pretty-printed JSON manifest of all registered frontend-model resources", async () => {
    const configuration = buildConfiguration({apiManifest: true})
    const response = await resolveGet(configuration, "/api/manifest")
    const body = response.getBody()

    if (typeof body !== "string") throw new Error("Expected manifest response body to be a string")

    const payload = JSON.parse(body)

    expect(response.getStatusCode()).toEqual(200)
    expect(response.headers["Content-Type"]).toEqual(["application/json; charset=UTF-8"])
    expect(body.startsWith("{\n  ")).toEqual(true)
    expect(payload.formatVersion).toEqual(1)

    const resources = /** @type {Record<string, unknown>} */ (payload.resources)

    expect(Object.keys(resources).sort()).toEqual(["InternalName", "Resource", "User"])

    // A resource registered under "InternalName" with static modelName "PublicName"
    // reports its modelName override but uses the registry key for the path.
    const renamed = /** @type {Record<string, unknown>} */ (resources.InternalName)

    expect(renamed.modelName).toEqual("PublicName")
    expect(renamed.path).toEqual("/internal-names")

    const user = /** @type {Record<string, unknown>} */ (resources.User)

    expect(user.path).toEqual("/users")
    expect(user.modelName).toEqual("User")
    expect(user.primaryKey).toEqual("id")
    expect(new Set(/** @type {string[]} */ (user.attributes))).toEqual(new Set(["id", "email", "name", "createdAt"]))
    expect(user.relationships).toEqual({account: {}})
    expect(user.abilities).toEqual({
      approve: "approve",
      create: "create",
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    })

    const builtInCommands = /** @type {Record<string, unknown>} */ (user.builtInCommands)

    expect(builtInCommands.collection).toEqual({create: "create", index: "index"})
    expect(builtInCommands.member).toEqual({find: "find", update: "update"})

    const commands = /** @type {Record<string, unknown>} */ (user.commands)
    const memberCommands = /** @type {Record<string, unknown>[]} */ (commands.member)

    expect(memberCommands.length).toEqual(1)
    expect(memberCommands[0].methodName).toEqual("suspend")
    expect(memberCommands[0].scope).toEqual("member")
    expect(memberCommands[0].path).toEqual("/users/<id>/suspend")
    expect(memberCommands[0].returnType).toEqual("{success: boolean}")
    expect(memberCommands[0].args).toEqual([])

    const collectionCommands = /** @type {Record<string, unknown>[]} */ (commands.collection)

    expect(collectionCommands.length).toEqual(2)
    expect(collectionCommands.find((cmd) => cmd.methodName === "searchByEmail")).toEqual({
      args: [{name: "email", type: "string"}],
      methodName: "searchByEmail",
      path: "/users/search-by-email",
      returnType: "{found: boolean}",
      scope: "collection"
    })
  })

  it("supports a custom manifest endpoint path", async () => {
    const response = await resolveGet(buildConfiguration({apiManifest: {path: "/internal/api-manifest"}}), "/internal/api-manifest")
    const body = response.getBody()

    if (typeof body !== "string") throw new Error("Expected manifest response body to be a string")

    expect(response.getStatusCode()).toEqual(200)
    expect(JSON.parse(body).resources).toBeDefined()
  })

  it("returns 404 when a token is configured but the request has no bearer token", async () => {
    const response = await resolveGet(buildConfiguration({apiManifest: {token: "secret-manifest-token"}}), "/api/manifest")

    expect(response.getStatusCode()).toEqual(404)
  })

  it("returns 404 when a token is configured but the bearer token is wrong", async () => {
    const response = await resolveGet(buildConfiguration({apiManifest: {token: "secret-manifest-token"}}), "/api/manifest", {authorization: "Bearer wrong-token"})

    expect(response.getStatusCode()).toEqual(404)
  })

  it("returns manifest with the correct bearer token and never exposes the token", async () => {
    const response = await resolveGet(buildConfiguration({apiManifest: {token: "secret-manifest-token"}}), "/api/manifest", {authorization: "Bearer secret-manifest-token"})
    const body = response.getBody()

    if (typeof body !== "string") throw new Error("Expected manifest response body to be a string")

    expect(response.getStatusCode()).toEqual(200)
    expect(JSON.parse(body).resources).toBeDefined()
    expect(body.includes("secret-manifest-token")).toEqual(false)
  })

  it("does not resolve application tenant or ability for authorized manifest requests", async () => {
    let resolvedAbility = false
    let resolvedTenant = false
    const configuration = buildConfiguration({
      abilityResolver: () => {
        resolvedAbility = true
        throw new Error("Ability resolver should not run for manifest endpoint")
      },
      apiManifest: {token: "secret-manifest-token"},
      tenantResolver: () => {
        resolvedTenant = true
        throw new Error("Tenant resolver should not run for manifest endpoint")
      }
    })
    const response = await resolveGet(configuration, "/api/manifest", {authorization: "Bearer secret-manifest-token"})

    expect(response.getStatusCode()).toEqual(200)
    expect(resolvedAbility).toEqual(false)
    expect(resolvedTenant).toEqual(false)
  })
})
