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
 * @param {Record<string, import("../../src/configuration-types.js").FrontendModelResourceConfiguration>} [args.resources]
 * @param {Record<string, any>} [args.modelClasses]
 * @param {any} [args.currentAbility]
 * @param {Partial<import("../../src/configuration-types.js").FrontendModelResourceConfiguration>} [args.resourceConfiguration]
 * @param {import("../../src/configuration-types.js").FrontendModelResourceServerConfiguration} [args.serverConfiguration]
 * @returns {FrontendController}
 */
function buildController(args = {}) {
  const request = new FakeRequest({httpMethod: args.httpMethod})
  const response = new FakeResponse()
  /** @type {import("../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  const frontendModelResourceConfiguration = {
    attributes: ["id", "name"],
    abilities: {
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    },
    path: "/frontend-models",
    primaryKey: "id",
    server: args.serverConfiguration,
    ...args.resourceConfiguration
  }

  return new FrontendController({
    action: "frontendIndex",
    configuration: {
      getBackendProjects: () => [{
        path: "/tmp/example",
        resources: args.resources || {
          MockFrontendModel: frontendModelResourceConfiguration
        }
      }],
      getCurrentAbility: () => args.currentAbility,
      getModelClasses: () => args.modelClasses || ({MockFrontendModel})
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
  static lastQuery = null
  static relationshipsMap = {}

  /**
   * @returns {Record<string, string>}
   */
  static getAttributeNameToColumnNameMap() {
    return {
      createdAt: "created_at",
      id: "id",
      name: "name"
    }
  }

  /** @param {Record<string, any>} attributes */
  constructor(attributes) {
    this._attributes = {...attributes}
  }

  /**
   * @returns {Record<string, any>}
   */
  static getRelationshipsMap() {
    return this.relationshipsMap
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

  /**
   * @returns {MockFrontendModelQuery}
   */
  static accessibleFor() {
    return new MockFrontendModelQuery(this)
  }

  /**
   * @returns {{getPreloaded: () => boolean, loaded: () => any}}
   */
  getRelationshipByName() {
    return {
      getPreloaded: () => false,
      loaded: () => undefined
    }
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

/** Minimal query object for ability-scoped mock model tests. */
class MockFrontendModelQuery {
  /**
   * @param {typeof MockFrontendModel} modelClass
   */
  constructor(modelClass) {
    this.modelClass = modelClass
    this.conditions = {}
    this.groupSqls = []
    this.joinsArgs = []
    this.preloads = []
    this.whereSqls = []
    this.modelClass.lastQuery = this
  }

  /**
   * @param {Record<string, any> | string} conditions
   * @returns {this}
   */
  where(conditions) {
    if (typeof conditions === "string") {
      this.whereSqls.push(conditions)
      return this
    }

    this.conditions = {...this.conditions, ...conditions}
    return this
  }

  /**
   * @param {Record<string, any>} preload
   * @returns {this}
   */
  preload(preload) {
    this.preloads.push(preload)
    return this
  }

  /**
   * @param {string} groupSql
   * @returns {this}
   */
  group(groupSql) {
    this.groupSqls.push(groupSql)
    return this
  }

  /**
   * @param {Record<string, any>} _joinObject
   * @returns {this}
   */
  joins(_joinObject) {
    this.joinsArgs.push(_joinObject)
    return this
  }

  /**
   * @param {...string} path
   * @returns {string}
   */
  getTableReferenceForJoin(...path) {
    if (path.length === 0) return "mock_frontend_models"

    return path.join("__")
  }

  /** @returns {{quote: (value: any) => string, quoteColumn: (value: string) => string, quoteTable: (value: string) => string}} */
  get driver() {
    return {
      quote: (value) => JSON.stringify(value),
      quoteColumn: (value) => `"${value}"`,
      quoteTable: (value) => `"${value}"`
    }
  }

  /** @returns {Promise<MockFrontendModel[]>} */
  async toArray() {
    const records = this.modelClass.data.filter((record) => this.matches(record))
    return records.map((record) => new this.modelClass(record))
  }

  /**
   * @param {Record<string, any>} conditions
   * @returns {Promise<MockFrontendModel | null>}
   */
  async findBy(conditions) {
    const records = this.modelClass.data.filter((record) => this.matches(record))
    const key = Object.keys(conditions)[0]
    const value = conditions[key]
    const found = records.find((record) => `${record[key]}` === `${value}`)

    return found ? new this.modelClass(found) : null
  }

  /**
   * @param {string} column
   * @returns {Promise<any[]>}
   */
  async pluck(column) {
    const records = this.modelClass.data.filter((record) => this.matches(record))
    return records.map((record) => record[column])
  }

  /**
   * @param {Record<string, any>} record
   * @returns {boolean}
   */
  matches(record) {
    for (const key in this.conditions) {
      const expectedValue = this.conditions[key]

      if (Array.isArray(expectedValue)) {
        if (!expectedValue.map((value) => `${value}`).includes(`${record[key]}`)) return false
      } else if (`${record[key]}` !== `${expectedValue}`) {
        return false
      }
    }

    return true
  }
}

/**
 * @param {string} deniedAbilityAction
 * @returns {typeof MockFrontendModel}
 */
function buildAbilityDeniedModelClass(deniedAbilityAction) {
  /** Frontend model class that can deny one ability action through accessibleFor scopes. */
  class AbilityDeniedFrontendModel extends MockFrontendModel {
    /** @type {string[]} */
    static seenAbilityActions = []

    /**
     * @param {string} abilityAction
     * @returns {MockFrontendModelQuery}
     */
    static accessibleFor(abilityAction) {
      this.seenAbilityActions.push(abilityAction)
      const query = new MockFrontendModelQuery(this)

      if (abilityAction === deniedAbilityAction) {
        query.matches = () => false
      }

      return query
    }
  }

  return AbilityDeniedFrontendModel
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

  it("handles shared frontend-model API batch requests by model name", async () => {
    MockFrontendModel.data = [
      {id: "1", name: "One"},
      {id: "2", name: "Two"}
    ]

    const controller = buildController({
      params: {
        requests: [
          {
            commandType: "index",
            model: "MockFrontendModel",
            payload: {},
            requestId: "request-1"
          }
        ]
      }
    })

    await controller.frontendApi()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      responses: [
        {
          requestId: "request-1",
          response: {
            models: [
              {id: "1", name: "One"},
              {id: "2", name: "Two"}
            ],
            status: "success"
          }
        }
      ],
      status: "success"
    })
  })

  it("applies preload params to frontendIndex query", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    const controller = buildController({
      params: {
        preload: {
          tasks: ["comments"]
        }
      }
    })

    await controller.frontendIndex()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      models: [{id: "1", name: "One"}],
      status: "success"
    })
    expect(MockFrontendModel.lastQuery?.preloads).toEqual([
      {
        tasks: {
          comments: true
        }
      }
    ])
  })

  it("merges nested preload entries from array shorthand", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    const controller = buildController({
      params: {
        preload: [
          {tasks: ["comments"]},
          {tasks: ["labels"]}
        ]
      }
    })

    await controller.frontendIndex()

    expect(MockFrontendModel.lastQuery?.preloads).toEqual([
      {
        tasks: {
          comments: true,
          labels: true
        }
      }
    ])
  })

  it("filters serialized frontendIndex attributes by select map", async () => {
    MockFrontendModel.data = [
      {email: "one@example.com", id: "1", name: "One"},
      {email: "two@example.com", id: "2", name: "Two"}
    ]

    const controller = buildController({
      params: {
        select: {
          MockFrontendModel: ["id"]
        }
      }
    })

    await controller.frontendIndex()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      models: [
        {
          id: "1"
        },
        {
          id: "2"
        }
      ],
      status: "success"
    })
  })

  it("applies search params to frontendIndex query", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    const controller = buildController({
      params: {
        searches: [
          {
            column: "createdAt",
            operator: "gteq",
            path: [],
            value: "2026-02-24T10:00:00.000Z"
          }
        ]
      }
    })

    await controller.frontendIndex()

    expect(MockFrontendModel.lastQuery?.whereSqls).toEqual([
      "\"mock_frontend_models\".\"created_at\" >= \"2026-02-24T10:00:00.000Z\""
    ])
  })

  it("applies relationship-path search params to frontendIndex query", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    class MockAccountModel {
      /**
       * @returns {Record<string, string>}
       */
      static getAttributeNameToColumnNameMap() {
        return {
          createdAt: "created_at"
        }
      }

      /**
       * @returns {Record<string, any>}
       */
      static getRelationshipsMap() {
        return {}
      }
    }

    class MockAccountUserModel {
      /**
       * @returns {Record<string, string>}
       */
      static getAttributeNameToColumnNameMap() {
        return {}
      }

      /**
       * @returns {Record<string, any>}
       */
      static getRelationshipsMap() {
        return {
          account: {
            getTargetModelClass: () => MockAccountModel
          }
        }
      }
    }

    MockFrontendModel.relationshipsMap = {
      accountUsers: {
        getTargetModelClass: () => MockAccountUserModel
      }
    }

    const controller = buildController({
      params: {
        searches: [
          {
            column: "createdAt",
            operator: "gteq",
            path: ["accountUsers", "account"],
            value: "2026-02-24T10:00:00.000Z"
          }
        ]
      }
    })

    await controller.frontendIndex()

    expect(MockFrontendModel.lastQuery?.joinsArgs).toEqual([
      {
        accountUsers: {
          account: {}
        }
      }
    ])
    expect(MockFrontendModel.lastQuery?.whereSqls).toEqual([
      "\"accountUsers__account\".\"created_at\" >= \"2026-02-24T10:00:00.000Z\""
    ])
    MockFrontendModel.relationshipsMap = {}
  })

  it("applies relationship-path group params to frontendIndex query", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    class MockAccountModel {
      /**
       * @returns {Record<string, string>}
       */
      static getAttributeNameToColumnNameMap() {
        return {
          id: "id"
        }
      }

      /**
       * @returns {Record<string, any>}
       */
      static getRelationshipsMap() {
        return {}
      }
    }

    class MockProjectModel {
      /**
       * @returns {Record<string, string>}
       */
      static getAttributeNameToColumnNameMap() {
        return {}
      }

      /**
       * @returns {Record<string, any>}
       */
      static getRelationshipsMap() {
        return {
          account: {
            getTargetModelClass: () => MockAccountModel
          }
        }
      }
    }

    MockFrontendModel.relationshipsMap = {
      project: {
        getTargetModelClass: () => MockProjectModel
      }
    }

    const controller = buildController({
      params: {
        group: {
          project: {
            account: ["id"]
          }
        }
      }
    })

    await controller.frontendIndex()

    expect(MockFrontendModel.lastQuery?.joinsArgs).toEqual([
      {
        project: {
          account: {}
        }
      }
    ])
    expect(MockFrontendModel.lastQuery?.groupSqls).toEqual([
      "\"project__account\".\"id\""
    ])
    MockFrontendModel.relationshipsMap = {}
  })

  it("rejects unsafe string group params", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]

    const controller = buildController({
      params: {
        group: "id; DROP TABLE accounts"
      }
    })

    await expect(async () => {
      await controller.frontendIndex()
    }).toThrow(/Invalid group column/)
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

  it("applies preload params to frontendFind query", async () => {
    MockFrontendModel.data = [{id: "2", name: "Two"}]

    const controller = buildController({
      params: {
        id: "2",
        preload: {
          project: true
        }
      }
    })

    await controller.frontendFind()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      model: {id: "2", name: "Two"},
      status: "success"
    })
    expect(MockFrontendModel.lastQuery?.preloads).toEqual([
      {
        project: true
      }
    ])
  })

  it("returns error payload when frontendFind record is missing", async () => {
    MockFrontendModel.data = []

    const controller = buildController({params: {id: "404"}})

    await controller.frontendFind()

    const payload = JSON.parse(controller.response().body)

    expect(payload.status).toEqual("error")
    expect(payload.errorMessage).toEqual("MockFrontendModel not found.")
  })

  it("returns no models from frontendIndex when read ability scope denies access", async () => {
    const AbilityDeniedFrontendModel = buildAbilityDeniedModelClass("read")
    AbilityDeniedFrontendModel.data = [{id: "1", name: "One"}]
    const controller = buildController({
      modelClasses: {AbilityDeniedFrontendModel},
      resources: {
        AbilityDeniedFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id", "name"],
          path: "/frontend-models",
          primaryKey: "id"
        }
      }
    })

    await controller.frontendIndex()

    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      models: [],
      status: "success"
    })
    expect(AbilityDeniedFrontendModel.seenAbilityActions).toEqual(["read"])
  })

  it("returns not found from frontendFind when read ability scope denies access", async () => {
    const AbilityDeniedFrontendModel = buildAbilityDeniedModelClass("read")
    AbilityDeniedFrontendModel.data = [{id: "2", name: "Two"}]
    const controller = buildController({
      modelClasses: {AbilityDeniedFrontendModel},
      params: {id: "2"},
      resources: {
        AbilityDeniedFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id", "name"],
          path: "/frontend-models",
          primaryKey: "id"
        }
      }
    })

    await controller.frontendFind()

    const payload = JSON.parse(controller.response().body)

    expect(payload.status).toEqual("error")
    expect(payload.errorMessage).toEqual("AbilityDeniedFrontendModel not found.")
    expect(AbilityDeniedFrontendModel.seenAbilityActions).toEqual(["read"])
  })

  it("returns not found from frontendUpdate when update ability scope denies access", async () => {
    const AbilityDeniedFrontendModel = buildAbilityDeniedModelClass("update")
    AbilityDeniedFrontendModel.data = [{id: "2", name: "Two"}]
    const controller = buildController({
      modelClasses: {AbilityDeniedFrontendModel},
      params: {attributes: {name: "Changed"}, id: "2"},
      resources: {
        AbilityDeniedFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id", "name"],
          path: "/frontend-models",
          primaryKey: "id"
        }
      }
    })

    await controller.frontendUpdate()

    const payload = JSON.parse(controller.response().body)

    expect(payload.status).toEqual("error")
    expect(payload.errorMessage).toEqual("AbilityDeniedFrontendModel not found.")
    expect(AbilityDeniedFrontendModel.data).toEqual([{id: "2", name: "Two"}])
    expect(AbilityDeniedFrontendModel.seenAbilityActions).toEqual(["update"])
  })

  it("returns not found from frontendDestroy when destroy ability scope denies access", async () => {
    const AbilityDeniedFrontendModel = buildAbilityDeniedModelClass("destroy")
    AbilityDeniedFrontendModel.data = [{id: "2", name: "Two"}]
    const controller = buildController({
      modelClasses: {AbilityDeniedFrontendModel},
      params: {id: "2"},
      resources: {
        AbilityDeniedFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id", "name"],
          path: "/frontend-models",
          primaryKey: "id"
        }
      }
    })

    await controller.frontendDestroy()

    const payload = JSON.parse(controller.response().body)

    expect(payload.status).toEqual("error")
    expect(payload.errorMessage).toEqual("AbilityDeniedFrontendModel not found.")
    expect(AbilityDeniedFrontendModel.data).toEqual([{id: "2", name: "Two"}])
    expect(AbilityDeniedFrontendModel.seenAbilityActions).toEqual(["destroy"])
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
    MockFrontendModel.data = [{id: "9", name: "Nine"}]

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

  it("deserializes Date and undefined markers from request params", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]
    const seen = {attributes: null}
    const controller = buildController({
      params: {
        attributes: {
          dueAt: {__velocious_type: "date", value: "2026-02-20T12:00:00.000Z"},
          optionalValue: {__velocious_type: "undefined"}
        },
        id: "1"
      },
      serverConfiguration: {
        update: async ({attributes, model}) => {
          seen.attributes = attributes
          model.assign({
            id: model.attributes().id,
            name: "Updated"
          })
          return model
        }
      }
    })

    await controller.frontendUpdate()

    expect(seen.attributes?.dueAt instanceof Date).toEqual(true)
    expect(seen.attributes?.dueAt.toISOString()).toEqual("2026-02-20T12:00:00.000Z")
    expect("optionalValue" in /** @type {Record<string, any>} */ (seen.attributes)).toEqual(true)
    expect(seen.attributes?.optionalValue).toEqual(undefined)
  })

  it("serializes Date, undefined, bigint and non-finite number values in frontend JSON responses", async () => {
    MockFrontendModel.data = [{id: "1", name: "One"}]
    const createdAt = new Date("2026-02-20T12:00:00.000Z")

    const controller = buildController({
      params: {id: "1"},
      serverConfiguration: {
        serialize: async ({model}) => {
          return {
            createdAt,
            hugeCounter: 9007199254740993n,
            id: model.attributes().id,
            missing: undefined,
            notANumber: Number.NaN,
            positiveInfinity: Number.POSITIVE_INFINITY
          }
        }
      }
    })

    await controller.frontendFind()
    const payload = JSON.parse(controller.response().body)

    expect(payload).toEqual({
      model: {
        createdAt: {__velocious_type: "date", value: "2026-02-20T12:00:00.000Z"},
        hugeCounter: {__velocious_type: "bigint", value: "9007199254740993"},
        id: "1",
        missing: {__velocious_type: "undefined"},
        notANumber: {__velocious_type: "number", value: "NaN"},
        positiveInfinity: {__velocious_type: "number", value: "Infinity"}
      },
      status: "success"
    })
  })

  it("fails when resource abilities are missing", async () => {
    const controller = buildController({
      resourceConfiguration: {
        abilities: undefined
      }
    })

    await expect(async () => {
      await controller.frontendIndex()
    }).toThrow(/must define an 'abilities' object/)
  })

  it("serializes missing preloaded singular relationships as null", async () => {
    const controller = buildController()
    const fakeModelClass = {
      getRelationshipsMap() {
        return {projectDetail: {}}
      }
    }
    const fakeModel = {
      constructor: fakeModelClass,
      attributes() {
        return {id: "1", name: "One"}
      },
      getRelationshipByName() {
        return {
          getPreloaded() {
            return true
          },
          loaded() {
            return undefined
          }
        }
      }
    }
    const payload = await controller.serializeFrontendModel(/** @type {any} */ (fakeModel))

    expect(payload).toEqual({
      __preloadedRelationships: {
        projectDetail: null
      },
      id: "1",
      name: "One"
    })
  })

  it("filters serialized preloaded model attributes by select map", async () => {
    /** Related model class used in select-map preload serialization test. */
    class RelatedFrontendModel {
      /** @param {Record<string, any>} attributes */
      constructor(attributes) {
        this._attributes = attributes
      }

      /** @returns {Record<string, any>} */
      attributes() { return this._attributes }

      /** @returns {Record<string, any>} */
      static getRelationshipsMap() {
        return {}
      }
    }

    /** Parent model class used in select-map preload serialization test. */
    class ParentFrontendModel {
      /** @returns {Record<string, any>} */
      static getRelationshipsMap() {
        return {related: {}}
      }
    }

    const controller = buildController({
      params: {
        select: {
          ParentFrontendModel: ["id"],
          RelatedFrontendModel: ["value"]
        }
      }
    })
    const relatedModel = new RelatedFrontendModel({id: "related-1", value: "Allowed one"})
    const parentModel = {
      constructor: ParentFrontendModel,
      attributes() {
        return {id: "1", name: "Parent"}
      },
      getRelationshipByName() {
        return {
          getPreloaded() {
            return true
          },
          loaded() {
            return relatedModel
          }
        }
      }
    }

    const payload = await controller.serializeFrontendModel(/** @type {any} */ (parentModel))

    expect(payload).toEqual({
      __preloadedRelationships: {
        related: {
          value: "Allowed one"
        }
      },
      id: "1"
    })
  })

  it("does not serialize unauthorized nested preloaded relationships", async () => {
    /** Related model class used in nested authorization serialization test. */
    class RelatedFrontendModel {
      static whereCalls = 0
      static pluckCalls = 0

      /** @param {Record<string, any>} attributes */
      constructor(attributes) {
        this._attributes = attributes
      }

      /** @returns {Record<string, any>} */
      attributes() { return this._attributes }

      /** @returns {Record<string, any>} */
      static getRelationshipsMap() {
        return {}
      }

      /**
       * @returns {{where: ({id}: {id: string[]}) => {pluck: (column: string) => Promise<string[]>}}}
       */
      static accessibleFor() {
        const RelatedClass = this

        return {
          where: ({id}) => {
            RelatedClass.whereCalls += 1

            return {
              pluck: async (column) => {
                void column
                RelatedClass.pluckCalls += 1

                return id.filter((entry) => entry === "allowed")
              }
            }
          }
        }
      }
    }

    const controller = buildController({
      currentAbility: {},
      modelClasses: {
        MockFrontendModel,
        RelatedFrontendModel
      },
      resources: {
        MockFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id"],
          path: "/frontend-models",
          primaryKey: "id"
        },
        RelatedFrontendModel: {
          abilities: {find: "read", index: "read"},
          attributes: ["id"],
          path: "/related-frontend-models",
          primaryKey: "id"
        }
      }
    })

    const fakeParentModelClass = {
      getRelationshipsMap() {
        return {related: {}}
      }
    }
    const deniedRelated = new RelatedFrontendModel({id: "denied"})
    const parentModel = {
      constructor: fakeParentModelClass,
      attributes() {
        return {id: "1", name: "One"}
      },
      getRelationshipByName() {
        return {
          getPreloaded() {
            return true
          },
          loaded() {
            return deniedRelated
          }
        }
      }
    }

    const payload = await controller.serializeFrontendModel(/** @type {any} */ (parentModel))

    expect(payload).toEqual({
      __preloadedRelationships: {
        related: null
      },
      id: "1",
      name: "One"
    })
    expect(RelatedFrontendModel.whereCalls).toEqual(1)
    expect(RelatedFrontendModel.pluckCalls).toEqual(1)
  })

  it("authorizes preloaded has-many relationships in bulk", async () => {
    /** Related model class used in nested bulk authorization serialization test. */
    class RelatedFrontendModel {
      static whereCalls = 0
      static pluckCalls = 0

      /** @param {Record<string, any>} attributes */
      constructor(attributes) {
        this._attributes = attributes
      }

      /** @returns {Record<string, any>} */
      attributes() { return this._attributes }

      /** @returns {Record<string, any>} */
      static getRelationshipsMap() {
        return {}
      }

      /**
       * @returns {{where: ({id}: {id: string[]}) => {pluck: (column: string) => Promise<string[]>}}}
       */
      static accessibleFor() {
        const RelatedClass = this

        return {
          where: ({id}) => {
            RelatedClass.whereCalls += 1

            return {
              pluck: async (column) => {
                void column
                RelatedClass.pluckCalls += 1

                return id.filter((entry) => entry === "allowed-1" || entry === "allowed-2")
              }
            }
          }
        }
      }
    }

    const controller = buildController({
      currentAbility: {},
      modelClasses: {
        MockFrontendModel,
        RelatedFrontendModel
      },
      resources: {
        MockFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id"],
          path: "/frontend-models",
          primaryKey: "id"
        },
        RelatedFrontendModel: {
          abilities: {find: "read", index: "read"},
          attributes: ["id"],
          path: "/related-frontend-models",
          primaryKey: "id"
        }
      }
    })

    const fakeParentModelClass = {
      getRelationshipsMap() {
        return {related: {}}
      }
    }
    const relatedOne = new RelatedFrontendModel({id: "allowed-1", value: "One"})
    const relatedTwo = new RelatedFrontendModel({id: "denied", value: "Two"})
    const relatedThree = new RelatedFrontendModel({id: "allowed-2", value: "Three"})
    const parentModel = {
      constructor: fakeParentModelClass,
      attributes() {
        return {id: "1", name: "Parent"}
      },
      getRelationshipByName() {
        return {
          getPreloaded() {
            return true
          },
          loaded() {
            return [relatedOne, relatedTwo, relatedThree]
          }
        }
      }
    }

    const payload = await controller.serializeFrontendModel(/** @type {any} */ (parentModel))

    expect(payload).toEqual({
      __preloadedRelationships: {
        related: [
          {id: "allowed-1", value: "One"},
          {id: "allowed-2", value: "Three"}
        ]
      },
      id: "1",
      name: "Parent"
    })
    expect(RelatedFrontendModel.whereCalls).toEqual(1)
    expect(RelatedFrontendModel.pluckCalls).toEqual(1)
  })

  it("authorizes preloaded singular relationships in bulk for index serialization", async () => {
    /** Related model class used in nested singular bulk authorization serialization test. */
    class RelatedFrontendModel {
      static whereCalls = 0
      static pluckCalls = 0

      /** @param {Record<string, any>} attributes */
      constructor(attributes) {
        this._attributes = attributes
      }

      /** @returns {Record<string, any>} */
      attributes() { return this._attributes }

      /** @returns {Record<string, any>} */
      static getRelationshipsMap() {
        return {}
      }

      /**
       * @returns {{where: ({id}: {id: string[]}) => {pluck: (column: string) => Promise<string[]>}}}
       */
      static accessibleFor() {
        const RelatedClass = this

        return {
          where: ({id}) => {
            RelatedClass.whereCalls += 1

            return {
              pluck: async (column) => {
                void column
                RelatedClass.pluckCalls += 1

                return id.filter((entry) => entry.startsWith("allowed"))
              }
            }
          }
        }
      }
    }

    const controller = buildController({
      currentAbility: {},
      modelClasses: {
        MockFrontendModel,
        RelatedFrontendModel
      },
      resources: {
        MockFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id"],
          path: "/frontend-models",
          primaryKey: "id"
        },
        RelatedFrontendModel: {
          abilities: {find: "read", index: "read"},
          attributes: ["id"],
          path: "/related-frontend-models",
          primaryKey: "id"
        }
      }
    })

    const fakeParentModelClass = {
      getRelationshipsMap() {
        return {related: {}}
      }
    }
    const parentModels = [
      {
        constructor: fakeParentModelClass,
        attributes() {
          return {id: "1", name: "One"}
        },
        getRelationshipByName() {
          return {
            getPreloaded() {
              return true
            },
            loaded() {
              return new RelatedFrontendModel({id: "allowed-1", value: "Allowed one"})
            }
          }
        }
      },
      {
        constructor: fakeParentModelClass,
        attributes() {
          return {id: "2", name: "Two"}
        },
        getRelationshipByName() {
          return {
            getPreloaded() {
              return true
            },
            loaded() {
              return new RelatedFrontendModel({id: "denied-2", value: "Denied"})
            }
          }
        }
      },
      {
        constructor: fakeParentModelClass,
        attributes() {
          return {id: "3", name: "Three"}
        },
        getRelationshipByName() {
          return {
            getPreloaded() {
              return true
            },
            loaded() {
              return new RelatedFrontendModel({id: "allowed-3", value: "Allowed three"})
            }
          }
        }
      }
    ]

    const serialized = await controller.serializeFrontendModels(/** @type {any} */ (parentModels))

    expect(serialized).toEqual([
      {
        __preloadedRelationships: {
          related: {id: "allowed-1", value: "Allowed one"}
        },
        id: "1",
        name: "One"
      },
      {
        __preloadedRelationships: {
          related: null
        },
        id: "2",
        name: "Two"
      },
      {
        __preloadedRelationships: {
          related: {id: "allowed-3", value: "Allowed three"}
        },
        id: "3",
        name: "Three"
      }
    ])
    expect(RelatedFrontendModel.whereCalls).toEqual(1)
    expect(RelatedFrontendModel.pluckCalls).toEqual(1)
  })

  it("does not serialize nested preloaded models without frontend resource definitions", async () => {
    /** Related backend-only model class used in nested authorization serialization test. */
    class BackendOnlyRelatedModel {
      /** @param {Record<string, any>} attributes */
      constructor(attributes) {
        this._attributes = attributes
      }

      /** @returns {Record<string, any>} */
      attributes() { return this._attributes }
    }

    const controller = buildController({
      currentAbility: {},
      modelClasses: {
        BackendOnlyRelatedModel,
        MockFrontendModel
      },
      resources: {
        MockFrontendModel: {
          abilities: {destroy: "destroy", find: "read", index: "read", update: "update"},
          attributes: ["id"],
          path: "/frontend-models",
          primaryKey: "id"
        }
      }
    })

    const fakeParentModelClass = {
      getRelationshipsMap() {
        return {related: {}}
      }
    }
    const backendOnlyRelated = new BackendOnlyRelatedModel({id: "secret"})
    const parentModel = {
      constructor: fakeParentModelClass,
      attributes() {
        return {id: "1", name: "One"}
      },
      getRelationshipByName() {
        return {
          getPreloaded() {
            return true
          },
          loaded() {
            return backendOnlyRelated
          }
        }
      }
    }

    const payload = await controller.serializeFrontendModel(/** @type {any} */ (parentModel))

    expect(payload).toEqual({
      __preloadedRelationships: {
        related: null
      },
      id: "1",
      name: "One"
    })
  })
})
