// @ts-check

import FrontendModelController from "../../src/frontend-model-controller.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** Fake request for controller unit tests. */
class FakeRequest {
  /** @param {{httpMethod?: string, path?: string}} [args] */
  constructor(args = {}) {
    this._httpMethod = args.httpMethod || "POST"
    this._path = args.path || "/frontend"
  }

  /** @returns {string} */
  httpMethod() { return this._httpMethod }

  /** @returns {string} */
  path() { return this._path }

  /** @returns {undefined} */
  header() { return undefined }
}

/** Fake response for controller unit tests. */
class FakeResponse {
  constructor() {
    this.body = ""
    this.headers = {}
    this.statusCode = 200
  }

  /** @param {string} key @param {string} value */
  setHeader(key, value) {
    this.headers[key] = value
  }

  /** @param {string} body */
  setBody(body) {
    this.body = body
  }

  /** @param {number|string} status */
  setStatus(status) {
    this.statusCode = typeof status === "number" ? status : 200
  }

  /** @returns {number} */
  getStatusCode() {
    return this.statusCode
  }

  /** @param {string} key @param {string} value */
  addHeader(key, value) {
    this.headers[key] = value
  }
}

/**
 * @param {object} [args]
 * @param {Record<string, any>} [args.params]
 * @param {string} [args.httpMethod]
 * @param {import("../../src/configuration-types.js").FrontendModelResourceServerConfiguration} [args.serverConfiguration]
 * @returns {FrontendController}
 */
function buildController(args = {}) {
  const request = new FakeRequest({httpMethod: args.httpMethod})
  const response = new FakeResponse()
  /** @type {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  const frontendModelResourceConfiguration = {
    attributes: ["id", "name"],
    path: "/frontend-models",
    primaryKey: "id",
    server: args.serverConfiguration
  }

  return new FrontendController({
    action: "frontendIndex",
    configuration: {
      getBackendProjects: () => [{
        path: "/tmp/example",
        resources: {
          MockFrontendModel: frontendModelResourceConfiguration
        }
      }],
      getCurrentAbility: () => undefined,
      getModelClasses: () => ({MockFrontendModel})
    },
    controller: "frontend-models",
    params: args.params || {},
    request,
    response,
    viewPath: import.meta.dirname
  })
}

/** Test frontend model class for controller action specs. */
class MockFrontendModel {
  /** @type {Record<string, any>[]} */
  static data = [
    {id: "1", name: "One"},
    {id: "2", name: "Two"}
  ]

  /** @param {Record<string, any>} attributes */
  constructor(attributes) {
    this._attributes = {...attributes}
  }

  /** @returns {Promise<MockFrontendModel[]>} */
  static async toArray() {
    return this.data.map((attributes) => new this(attributes))
  }

  /** @param {{id: string | number}} args @returns {Promise<MockFrontendModel | null>} */
  static async findBy({id}) {
    const attributes = this.data.find((record) => `${record.id}` === `${id}`)

    return attributes ? new this(attributes) : null
  }

  /** @returns {Record<string, any>} */
  attributes() {
    return {...this._attributes}
  }

  /** @param {Record<string, any>} attributes */
  assign(attributes) {
    Object.assign(this._attributes, attributes)
  }

  /** @returns {Promise<void>} */
  async save() {
    // no-op
  }

  /** @returns {Promise<void>} */
  async destroy() {
    MockFrontendModel.data = MockFrontendModel.data.filter((record) => `${record.id}` !== `${this._attributes.id}`)
  }
}

/** Test controller using built-in frontend model actions. */
class FrontendController extends FrontendModelController {}

describe("Controller frontend model actions", () => {
  it("returns models from frontendIndex", async () => {
    MockFrontendModel.data = [
      {id: "1", name: "One"},
      {id: "2", name: "Two"}
    ]

    const controller = buildController()

    await controller.frontendIndex()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      models: [
        {id: "1", name: "One"},
        {id: "2", name: "Two"}
      ],
      status: "success"
    })
  })

  it("returns one model from frontendFind", async () => {
    MockFrontendModel.data = [{id: "2", name: "Two"}]

    const controller = buildController({params: {id: "2"}})

    await controller.frontendFind()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      model: {id: "2", name: "Two"},
      status: "success"
    })
  })

  it("returns error payload when frontendFind record is missing", async () => {
    MockFrontendModel.data = []

    const controller = buildController({params: {id: "404"}})

    await controller.frontendFind()

    const payload = JSON.parse(controller.response().body)

    expect(payload.status).toEqual("error")
    expect(payload.errorMessage).toEqual("MockFrontendModel not found.")
  })

  it("runs server beforeAction callback", async () => {
    let beforeActionCalls = 0
    const controller = buildController({
      serverConfiguration: {
        beforeAction: async () => {
          beforeActionCalls += 1
          return true
        }
      }
    })

    await controller.frontendIndex()

    expect(beforeActionCalls).toEqual(1)
  })

  it("supports server records callback", async () => {
    const controller = buildController({
      serverConfiguration: {
        records: async () => [new MockFrontendModel({id: "9", name: "Nine"})]
      }
    })

    await controller.frontendIndex()
    const payload = JSON.parse(controller.response().body)

    expect(payload.models).toEqual([{id: "9", name: "Nine"}])
  })

  it("supports server serialize callback", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    const controller = buildController({
      params: {id: "1"},
      serverConfiguration: {
        serialize: async ({model}) => {
          return {
            id: model.attributes().id,
            label: model.attributes().name
          }
        }
      }
    })

    await controller.frontendFind()
    const payload = JSON.parse(controller.response().body)

    expect(payload.model).toEqual({id: "1", label: "One"})
  })
})
