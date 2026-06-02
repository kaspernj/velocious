// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"

/** @returns {Promise<FrontendModelController>} - Bare controller for direct method calls. */
async function buildController() {
  const configuration = new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })

  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from([
    "POST /frontend-models HTTP/1.1",
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  await donePromise

  return new FrontendModelController({
    action: "frontendApi",
    configuration,
    controller: "frontend-models",
    params: {},
    request,
    response: new Response({configuration}),
    viewPath: `${dummyDirectory()}/src/routes/frontend-models`
  })
}

/**
 * Minimal duck-typed backend `Record` shape — `isBackendModelInstance` checks
 * for `attributes()`, `getModelClass()`, and `getRelationshipByName()`. The
 * walker also reads `constructor.getModelName()` for the marker `modelName`.
 *
 * @param {string} id - Model id used in serialized output.
 * @param {string} [modelName="Build"] - Model name reported by the constructor.
 * @returns {{attributes: () => Record<string, any>, constructor: {getModelName: () => string, name: string}, getModelClass: () => Record<string, any>, getRelationshipByName: () => Record<string, any>, __id: string}} - Record stand-in.
 */
function makeFakeRecord(id, modelName = "Build") {
  return {
    __id: id,
    attributes: () => ({id}),
    constructor: {getModelName: () => modelName, name: modelName},
    getModelClass: () => ({getRelationshipsMap: () => ({})}),
    getRelationshipByName: () => ({getPreloaded: () => false, loaded: () => null})
  }
}

describe("FrontendModelController autoSerializeFrontendModelsInPayload", {databaseCleaning: {transaction: true}}, () => {
  it("replaces a top-level backend Record with a frontend_model marker carrying resource.serialize output", async () => {
    const controller = await buildController()
    /** @type {Array<{model: any, action: string}>} */
    const calls = []
    const resource = {
      async serialize(model, action) {
        calls.push({action, model})
        return {id: model.attributes().id, name: "build-name"}
      }
    }
    const record = makeFakeRecord("build-1")

    const result = await controller.autoSerializeFrontendModelsInPayload(record, resource, "cancel")

    expect(calls).toHaveLength(1)
    expect(calls[0].action).toEqual("cancel")
    expect(calls[0].model).toBe(record)
    expect(result).toEqual({
      __velocious_type: "frontend_model",
      attributes: {id: "build-1", name: "build-name"},
      modelName: "Build"
    })
  })

  it("replaces a nested backend Record under a plain-object payload", async () => {
    const controller = await buildController()
    const resource = {
      async serialize(model, action) {
        return {id: model.attributes().id, action}
      }
    }
    const record = makeFakeRecord("build-7")

    const result = await controller.autoSerializeFrontendModelsInPayload(
      {build: record, status: "ok"},
      resource,
      "cancel"
    )

    expect(result).toEqual({
      build: {
        __velocious_type: "frontend_model",
        attributes: {id: "build-7", action: "cancel"},
        modelName: "Build"
      },
      status: "ok"
    })
  })

  it("walks arrays and replaces backend Records inside them", async () => {
    const controller = await buildController()
    const resource = {
      async serialize(model) {
        return {id: model.attributes().id}
      }
    }
    const records = [makeFakeRecord("a", "User"), makeFakeRecord("b", "User"), makeFakeRecord("c", "User")]

    const result = await controller.autoSerializeFrontendModelsInPayload({users: records}, resource, "lookupByEmail")

    expect(result).toEqual({
      users: [
        {__velocious_type: "frontend_model", attributes: {id: "a"}, modelName: "User"},
        {__velocious_type: "frontend_model", attributes: {id: "b"}, modelName: "User"},
        {__velocious_type: "frontend_model", attributes: {id: "c"}, modelName: "User"}
      ]
    })
  })

  it("passes null, undefined, primitives, and Date values through unchanged", async () => {
    const controller = await buildController()
    const resource = {
      async serialize() {
        throw new Error("Should not be called for non-Record values.")
      }
    }
    const date = new Date("2026-01-01T00:00:00Z")

    const result = await controller.autoSerializeFrontendModelsInPayload(
      {count: 3, enabled: true, missing: null, name: "alpha", noValue: undefined, when: date},
      resource,
      "cancel"
    )

    expect(result).toEqual({
      count: 3,
      enabled: true,
      missing: null,
      name: "alpha",
      noValue: undefined,
      when: date
    })
  })

  it("walks a plain-object container that is referenced twice (shared but non-cyclic) so backend Records inside both references are serialized", async () => {
    const controller = await buildController()
    let serializeCalls = 0
    const resource = {
      async serialize(model) {
        serializeCalls += 1

        return {id: model.attributes().id}
      }
    }
    const sharedRecord = makeFakeRecord("shared", "Build")
    const sharedContainer = /** @type {Record<string, any>} */ ({build: sharedRecord})

    const result = /** @type {Record<string, any>} */ (
      await controller.autoSerializeFrontendModelsInPayload(
        {first: sharedContainer, second: sharedContainer, status: "ok"},
        resource,
        "cancel"
      )
    )

    expect(serializeCalls).toEqual(2)
    expect(result.first).toEqual({
      build: {__velocious_type: "frontend_model", attributes: {id: "shared"}, modelName: "Build"}
    })
    expect(result.second).toEqual({
      build: {__velocious_type: "frontend_model", attributes: {id: "shared"}, modelName: "Build"}
    })
    expect(result.status).toEqual("ok")
  })

  it("stores a `__proto__` key as an own data property without polluting Object.prototype", async () => {
    const controller = await buildController()
    const resource = {
      async serialize(model) {
        return {id: model.attributes().id}
      }
    }
    const payload = /** @type {Record<string, any>} */ (JSON.parse('{"safe":1,"__proto__":{"polluted":true}}'))

    try {
      const result = /** @type {Record<string, any>} */ (
        await controller.autoSerializeFrontendModelsInPayload(payload, resource, "cancel")
      )

      expect(/** @type {Record<string, any>} */ (Object.prototype).polluted).toEqual(undefined)
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toEqual(true)
      expect(result["__proto__"].polluted).toEqual(true)
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    } finally {
      delete /** @type {Record<string, any>} */ (Object.prototype).polluted
    }
  })

  it("does not infinite-loop on cyclic plain-object references", async () => {
    const controller = await buildController()
    const resource = {
      async serialize(model) {
        return {id: model.attributes().id}
      }
    }
    /** @type {Record<string, any>} */
    const payload = {build: makeFakeRecord("build-x"), status: "ok"}

    payload.self = payload

    const result = /** @type {Record<string, any>} */ (
      await controller.autoSerializeFrontendModelsInPayload(payload, resource, "cancel")
    )

    expect(result.build).toEqual({
      __velocious_type: "frontend_model",
      attributes: {id: "build-x"},
      modelName: "Build"
    })
    expect(result.status).toEqual("ok")
    expect(result.self).toBeDefined()
  })
})
