// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"
import LocalMutationLog from "../../src/sync/local-mutation-log.js"
import {buildPreloadTestModelClasses, resetFrontendModelTransport, stubFrontendModelFetch} from "../helpers/frontend-model-test-helpers.js"

/** @typedef {{body: Record<string, any>, url: string}} FetchCall */

/**
 * @typedef {object} SharedWebsocketAttachmentFixture
 * @property {FetchCall[]} fetchCalls - Direct fetch calls.
 * @property {() => void} restore - Restores global transport state.
 * @property {any} task - Attachment test task.
 * @property {Array<{path: string, body: Record<string, any>}>} websocketCalls - Shared websocket calls.
 */

/**
 * @returns {typeof FrontendModelBase} - Test frontend model class.
 */
function buildTestModelClass() {
  /** Test model implementation for frontend model base specs. */
  class User extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name", "email", "userId"],
        commands: ["create", "destroy", "find", "index", "update"],
        primaryKey: "id"
      }
    }

    /** @returns {any} */
    id() { return this.readAttribute("id") }

    /** @returns {any} */
    name() { return this.readAttribute("name") }

    /** @returns {any} */
    email() { return this.readAttribute("email") }

    /** @returns {any} */
    userId() { return this.readAttribute("userId") }

    /**
     * @param {any} newValue
     * @returns {any}
     */
    setEmail(newValue) { return this.setAttribute("email", newValue) }

    /**
     * @param {any} newValue
     * @returns {any}
     */
    setName(newValue) { return this.setAttribute("name", newValue) }

    /**
     * @param {any} newValue
     * @returns {any}
     */
    setUserId(newValue) { return this.setAttribute("userId", newValue) }
  }

  return User
}

/**
 * @param {{operations: string[]}} args - Sync configuration args.
 * @returns {typeof FrontendModelBase} - Offline sync test frontend model class.
 */
function buildOfflineSyncTestModelClass({operations}) {
  /** Test model implementation for offline sync specs. */
  class User extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string, sync: {enabled: boolean, operations: string[], policyHash: string, policyVersion: string | null}}} - Resource configuration. */
    static resourceConfig() {
      return {
        attributes: ["id", "name", "email", "userId"],
        commands: ["create", "destroy", "find", "index", "update"],
        primaryKey: "id",
        sync: {
          enabled: true,
          operations,
          policyHash: "sha256-user",
          policyVersion: null
        }
      }
    }

    /** @returns {any} */
    id() { return this.readAttribute("id") }
  }

  return User
}

/**
 * @returns {typeof FrontendModelBase} - Offline sync attachment test model class.
 */
function buildOfflineAttachmentSyncTestModelClass() {
  /** Offline sync frontend model with attachment definitions. */
  class Task extends FrontendModelBase {
    /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} - Resource configuration. */
    static resourceConfig() {
      return {
        attachments: {descriptionFile: {type: "hasOne"}},
        attributes: ["id", "name"],
        commands: ["update"],
        primaryKey: "id",
        sync: {
          enabled: true,
          operations: ["update"],
          policyHash: "sha256-task",
          policyVersion: null
        }
      }
    }
  }

  return Task
}

/**
 * @returns {{Project: typeof FrontendModelBase}} - Offline sync nested test classes.
 */
function buildOfflineNestedSyncTestClasses() {
  /** Offline nested sync child model. */
  class Task extends FrontendModelBase {
    /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "projectId", "name"], primaryKey: "id"}
    }
  }

  /** Offline nested sync parent model. */
  class Project extends FrontendModelBase {
    /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} - Resource configuration. */
    static resourceConfig() {
      return {
        attributes: ["id", "name"],
        commands: ["create"],
        nestedAttributes: {tasks: {allowDestroy: true}},
        primaryKey: "id",
        sync: {
          enabled: true,
          operations: ["create"],
          policyHash: "sha256-project",
          policyVersion: null
        }
      }
    }
    /** @returns {Record<string, typeof FrontendModelBase>} */
    static relationshipModelClasses() { return {tasks: Task} }
    /** @returns {Record<string, {type: "hasMany"}>} */
    static relationshipDefinitions() { return {tasks: {type: "hasMany"}} }
  }

  return {Project}
}

/**
 * @returns {typeof FrontendModelBase} - Test model with createdAt attribute.
 */
function buildCreatedAtTestModelClass() {
  /** Test model implementation with createdAt attribute. */
  class User extends FrontendModelBase {
    /**
     * @returns {{attributes: string[]}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attributes: ["id", "createdAt"]
      }
    }

    /** @returns {any} */
    id() { return this.readAttribute("id") }

    /** @returns {any} */
    createdAt() { return this.readAttribute("createdAt") }
  }

  return User
}

/**
 * @returns {typeof FrontendModelBase} - Test frontend model class with scope support.
 */
function buildScopedTestModelClass() {
  /** Test model implementation with query scope support. */
  class Task extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attributes: ["id", "isDone", "name"],
        commands: ["index"],
        primaryKey: "id"
      }
    }
  }

  return Task
}

/**
 * @param {string} modelName - Frontend model resource name.
 * @returns {typeof FrontendModelBase} - Shared API test model class.
 */
function buildSharedApiTestModelClass(modelName) {
  /** Shared API frontend model. */
  class SharedApiModel extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], modelName: string, primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {
        attributes: ["id", "name"],
        commands: ["index"],
        modelName,
        primaryKey: "id"
      }
    }
  }

  return SharedApiModel
}

/**
 * @returns {typeof FrontendModelBase} - Test frontend model class with attachments.
 */
function buildAttachmentTestModelClass() {
  /** Test frontend model with attachment definitions. */
  class Task extends FrontendModelBase {
    /**
     * @returns {{attachments: Record<string, {type: "hasOne" | "hasMany"}>, attributes: string[], commands: string[], primaryKey: string}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attachments: {
          descriptionFile: {type: "hasOne"}
        },
        attributes: ["id", "name"],
        commands: ["attach", "download", "update"],
        primaryKey: "id"
      }
    }

    /** @returns {any} */
    id() { return this.readAttribute("id") }
  }

  return Task
}

/**
 * @returns {typeof FrontendModelBase} - Test frontend model class with custom primary key.
 */
function buildCustomPrimaryKeyTestModelClass() {
  /** Test model implementation with custom primary key. */
  class User extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attributes: ["reference", "name"],
        commands: ["find", "index"],
        primaryKey: "reference"
      }
    }

    /** @returns {any} */
    reference() { return this.readAttribute("reference") }
  }

  return User
}

/**
 * @param {{restore: () => void}} fetchStub - Fetch stub to restore.
 * @returns {void}
 */
function restoreFrontendModelFetch(fetchStub) {
  resetFrontendModelTransport()
  fetchStub.restore()
}

function buildMemoryStorage() {
  const values = new Map()

  return {
    getItem: async (key) => values.get(key) || null,
    setItem: async (key, value) => {
      values.set(key, value)
    }
  }
}

function nextNow(values) {
  let index = 0

  return () => new Date(values[index++] || values[values.length - 1])
}

/**
 * @returns {{Project: typeof FrontendModelBase, fetchStub: {calls: FetchCall[], restore: () => void}, project: any}} - Preloaded project relationship test fixture.
 */
function buildProjectTasksPreloadFixture() {
  const {Project} = buildPreloadTestModelClasses()
  const fetchStub = stubFetch({
    models: [{
      id: "1",
      name: "One",
      __preloadedRelationships: {
        tasks: [
          {id: "11", name: "Task 1"}
        ]
      }
    }]
  })
  const project = new Project({id: "1", name: "One"})

  return {Project, fetchStub, project}
}

/**
 * @returns {{User: typeof FrontendModelBase, fetchStub: {calls: FetchCall[], restore: () => void}, user: any}} - Update response test fixture.
 */
function buildUserUpdateResponseFixture() {
  const User = buildTestModelClass()
  const fetchStub = stubFetch({model: {email: "johnny@example.com", id: 5, name: "Johnny"}})
  const user = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})

  return {User, fetchStub, user}
}

/**
 * @returns {SharedWebsocketAttachmentFixture} - Attachment task using shared websocket transport with direct fetch capture.
 */
function buildSharedWebsocketAttachmentFixture() {
  const Task = buildAttachmentTestModelClass()
  const task = Task.instantiateFromResponse({id: 10, name: "Task"})
  const originalFetch = globalThis.fetch
  /** @type {FetchCall[]} */
  const fetchCalls = []
  /** @type {Array<{path: string, body: Record<string, any>}>} */
  const websocketCalls = []

  FrontendModelBase.configureTransport({
    shared: true,
    websocketClient: {
      post: async (path, body) => {
        websocketCalls.push({body, path})

        return {
          json: () => ({responses: [], status: "success"})
        }
      }
    }
  })
  globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
    const bodyString = typeof options?.body === "string" ? options.body : "{}"

    fetchCalls.push({
      body: JSON.parse(bodyString),
      url: `${url}`
    })

    return {
      ok: true,
      status: 200,
      /** @returns {Promise<string>} */
      text: async () => JSON.stringify({model: {id: 10, name: "Task"}}),
      /** @returns {Promise<Record<string, any>>} */
      json: async () => ({model: {id: 10, name: "Task"}})
    }
  })

  return {
    fetchCalls,
    restore: () => {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    },
    task,
    websocketCalls
  }
}

/**
 * @param {FetchCall[]} fetchCalls - Direct fetch calls.
 * @returns {void}
 */
function expectAttachmentUploadFetchCalls(fetchCalls) {
  expect(fetchCalls).toEqual([
    {
      body: {
        attachment: {
          contentBase64: "YQ==",
          contentType: null,
          filename: "a.txt"
        },
        attachmentName: "descriptionFile",
        id: 10
      },
      url: "/tasks/attach"
    }
  ])
}

/**
 * @param {any} project - Project frontend model.
 * @param {{calls: FetchCall[]}} fetchStub - Fetch stub with captured calls.
 * @param {Record<string, any>} nestedAttributes - Expected nested attributes payload.
 * @returns {Promise<void>}
 */
async function expectNestedAttributesAfterSave(project, fetchStub, nestedAttributes) {
  await project.save()

  expect(fetchStub.calls.length).toEqual(1)
  expect(fetchStub.calls[0].body.nestedAttributes).toEqual(nestedAttributes)
}

/**
 * @param {any} body - Shared frontend-model request body.
 * @param {Record<string, any>} response - Response payload for the first request.
 * @returns {Record<string, any>} - Shared API response envelope.
 */
function sharedFrontendModelResponse(body, response) {
  return {
    responses: [{
      requestId: body.requests[0].requestId,
      response
    }],
    status: "success"
  }
}

/**
 * @param {FetchCall[]} calls - Captured fetch calls.
 * @param {Record<string, any>} response - Response payload for the first request.
 * @returns {void}
 */
function stubSharedFrontendModelFetch(calls, response) {
  globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
    const body = recordSharedFrontendModelFetchCall(calls, url, options)

    return {
      ok: true,
      status: 200,
      /** @returns {Promise<string>} */
      text: async () => JSON.stringify(sharedFrontendModelResponse(body, response)),
      /** @returns {Promise<Record<string, any>>} */
      json: async () => sharedFrontendModelResponse(body, response)
    }
  })
}

/**
 * @param {FetchCall[]} calls - Captured fetch calls.
 * @param {string | URL | Request} url - Fetch URL argument.
 * @param {RequestInit | undefined} options - Fetch options.
 * @returns {Record<string, any>} - Parsed request body.
 */
function recordSharedFrontendModelFetchCall(calls, url, options) {
  const bodyString = typeof options?.body === "string" ? options.body : "{}"
  const body = JSON.parse(bodyString)

  calls.push({
    body,
    url: `${url}`
  })

  return body
}

/**
 * @param {FetchCall[]} calls - Captured fetch calls.
 * @returns {void}
 */
function expectSharedIndexRequest(calls) {
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toEqual("/frontend-models")
  expect(calls[0].body.requests[0].commandType).toEqual("index")
}

/**
 * @param {{calls: FetchCall[]}} fetchStub - Fetch stub with captured calls.
 * @returns {void}
 */
function expectPrimaryKeyFirstRequest(fetchStub) {
  expect(fetchStub.calls).toEqual([
    {
      body: {
        limit: 1,
        sort: [
          {
            column: "id",
            direction: "asc",
            path: []
          }
        ]
      },
      url: "/frontend-models"
    }
  ])
}

const stubFetch = stubFrontendModelFetch

describe("Frontend models - base", {databaseCleaning: {transaction: true}}, () => {
  it("defines root scopes on frontend model classes", () => {
    const Task = buildScopedTestModelClass()

    Task.withDoneState = Task.defineScope(({query}, isDone) => query.where({isDone}))

    expect(Task.withDoneState(true).wherePayload()).toEqual({where: {isDone: true}})
  })

  it("applies reusable frontend model scopes to existing queries", () => {
    const Task = buildScopedTestModelClass()

    Task.withDoneState = Task.defineScope(({query}, isDone) => query.where({isDone}))

    const query = Task
      .where({name: "Keep me"})
      .scope(Task.withDoneState.scope(false))

    expect(query.wherePayload()).toEqual({where: {isDone: false, name: "Keep me"}})
  })

  it("rejects query filters for destroy event subscriptions", async () => {
    const Task = buildTestModelClass()

    await expect(async () => {
      await Task.onDestroy(() => {}, Task.where({id: 1}))
    }).toThrow(/destroy event subscriptions do not support query filters/)
  })

  it("does not request unfiltered create or update delivery for destroy listeners", async () => {
    const Task = buildScopedTestModelClass()
    /** @type {Array<{destroyEventDelivery?: boolean, eventFilters?: Array<{where?: Record<string, unknown>}>, unfilteredEventDelivery?: boolean}>} */
    const subscriptionParams = []

    FrontendModelBase.configureTransport({
      websocketClient: {
        connect: async () => {},
        subscribeChannel: (_channel, options) => {
          subscriptionParams.push(options.params)

          return {
            close: () => {},
            isClosed: () => false,
            ready: Promise.resolve()
          }
        }
      }
    })

    const offUpdate = await Task.onUpdate(() => {}, Task.where({isDone: true}))
    const offDestroy = await Task.onDestroy(() => {})

    try {
      const latestParams = subscriptionParams[subscriptionParams.length - 1]

      if (!latestParams) throw new Error("Expected subscription params")
      if (!latestParams.eventFilters) throw new Error("Expected subscription event filters")

      expect(latestParams.unfilteredEventDelivery).toEqual(undefined)
      expect(latestParams.destroyEventDelivery).toEqual(true)
      expect(latestParams.eventFilters).toHaveLength(1)
      expect(latestParams.eventFilters[0].where).toEqual({isDone: true})
    } finally {
      offUpdate()
      offDestroy()
      resetFrontendModelTransport()
    }
  })

  it("uses the shared frontend-model API and batches requests by default", async () => {
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    try {
      const SharedApiUser = buildSharedApiTestModelClass("SharedApiUser")

      globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
        const bodyString = typeof options?.body === "string" ? options.body : "{}"
        const body = JSON.parse(bodyString)
        const responses = (body.requests || []).map((requestEntry) => ({
          requestId: requestEntry.requestId,
          response: {
            models: [{id: "1", name: "One"}],
            status: "success"
          }
        }))

        calls.push({body, url: `${url}`})

        return {
          ok: true,
          status: 200,
          /** @returns {Promise<string>} */
          text: async () => JSON.stringify({responses, status: "success"}),
          /** @returns {Promise<Record<string, any>>} */
          json: async () => ({responses, status: "success"})
        }
      })

      const [firstResult, secondResult] = await Promise.all([
        SharedApiUser.toArray(),
        SharedApiUser.toArray()
      ])

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toEqual("/frontend-models")
      expect(calls[0].body.requests).toHaveLength(2)
      expect(calls[0].body.requests[0].model).toEqual("SharedApiUser")
      expect(calls[0].body.requests[1].model).toEqual("SharedApiUser")
      expect(firstResult).toHaveLength(1)
      expect(secondResult).toHaveLength(1)
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("surfaces the backend errorMessage envelope from a 4xx shared frontend-model response", async () => {
    const originalFetch = globalThis.fetch

    /** Shared API user model. */
    class ErrorEnvelopeUser extends FrontendModelBase {
      /**
       * @returns {{attributes: string[], commands: string[], primaryKey: string}}
       */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          commands: ["index"],
          primaryKey: "id"
        }
      }
    }

    globalThis.fetch = /** @type {typeof fetch} */ (async () => /** @type {any} */ ({
      ok: false,
      status: 422,
      headers: {
        get: (key) => key.toLowerCase() === "content-type" ? "application/json; charset=UTF-8" : null
      },
      /** @returns {Promise<string>} */
      text: async () => JSON.stringify({
        errorMessage: "Resource is unavailable.",
        status: "error"
      })
    }))

    try {
      let captured

      try {
        await ErrorEnvelopeUser.toArray()
      } catch (error) {
        captured = error
      }

      expect(captured instanceof Error).toEqual(true)
      expect(captured.message).toEqual("Resource is unavailable.")
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("falls back to the status-only error when a 4xx response has no errorMessage envelope", async () => {
    const originalFetch = globalThis.fetch

    /** Shared API user model. */
    class StatusOnlyErrorUser extends FrontendModelBase {
      /**
       * @returns {{attributes: string[], commands: string[], primaryKey: string}}
       */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          commands: ["index"],
          primaryKey: "id"
        }
      }
    }

    globalThis.fetch = /** @type {typeof fetch} */ (async () => /** @type {any} */ ({
      ok: false,
      status: 503,
      headers: {
        get: () => "text/plain"
      },
      /** @returns {Promise<string>} */
      text: async () => "service unavailable"
    }))

    try {
      let captured

      try {
        await StatusOnlyErrorUser.toArray()
      } catch (error) {
        captured = error
      }

      expect(captured instanceof Error).toEqual(true)
      expect(captured.message).toEqual("Request failed (503) for shared frontend model API")
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("keeps built-in command aliases as built-in command types in shared requests", async () => {
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    try {
      const SharedApiTask = buildSharedApiTestModelClass("SharedApiTask")

      stubSharedFrontendModelFetch(calls, {models: [{id: "1", name: "One"}], status: "success"})

      await SharedApiTask.toArray()

      expectSharedIndexRequest(calls)
      expect(calls[0].body.requests[0].customPath).toEqual(undefined)
      expect(calls[0].body.requests[0].model).toEqual("SharedApiTask")
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("batches custom commands through the shared frontend-model API", async () => {
    const User = buildTestModelClass()
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    try {
      globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
        const body = recordSharedFrontendModelFetchCall(calls, url, options)

        return {
          ok: true,
          status: 200,
          /** @returns {Promise<string>} */
          text: async () => JSON.stringify(sharedFrontendModelResponse(body, {status: "success", value: "pong"})),
          /** @returns {Promise<Record<string, any>>} */
          json: async () => sharedFrontendModelResponse(body, {status: "success", value: "pong"})
        }
      })

      const response = await User.executeCustomCommand({
        commandName: "ping",
        commandType: "ping",
        memberId: 5,
        payload: {name: "John"},
        resourcePath: "/custom-frontend-models/users"
      })

      expect(calls).toEqual([
        {
          body: {
            requests: [{
              commandType: "ping",
              customPath: "/custom-frontend-models/users/5/ping",
              model: "User",
              payload: {name: "John"},
              requestId: calls[0].body.requests[0].requestId
            }]
          },
          url: "/frontend-models"
        }
      ])
      expect(response.status).toEqual("success")
      expect(response.value).toEqual("pong")
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("normalizes custom command arguments", () => {
    const User = buildTestModelClass()

    expect(User.normalizeCustomCommandPayloadArguments([])).toEqual({})
    expect(User.normalizeCustomCommandPayloadArguments([undefined])).toEqual({})
    expect(User.normalizeCustomCommandPayloadArguments([{}])).toEqual({})
    expect(User.normalizeCustomCommandPayloadArguments([{name: "John"}])).toEqual({name: "John"})
    expect(User.normalizeCustomCommandPayloadArguments([1])).toEqual({arg1: 1})
    expect(User.normalizeCustomCommandPayloadArguments([1, "admin", true])).toEqual({
      arg1: 1,
      arg2: "admin",
      arg3: true
    })
    expect(User.normalizeCustomCommandPayloadArguments([null])).toEqual({arg1: null})
  })

  it("infers default resource paths for pathless custom commands", async () => {
    const User = buildCustomPrimaryKeyTestModelClass()
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    try {
      globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
        const bodyString = typeof options?.body === "string" ? options.body : "{}"

        calls.push({
          body: JSON.parse(bodyString),
          url: `${url}`
        })

        return {
          ok: true,
          status: 200,
          /** @returns {Promise<string>} */
          text: async () => JSON.stringify({
            responses: [{
              requestId: calls[0].body.requests[0].requestId,
              response: {status: "success"}
            }],
            status: "success"
          }),
          /** @returns {Promise<Record<string, any>>} */
          json: async () => ({
            responses: [{
              requestId: calls[0].body.requests[0].requestId,
              response: {status: "success"}
            }],
            status: "success"
          })
        }
      })

      await User.executeCustomCommand({
        commandName: "refresh-access",
        commandType: "refresh-access",
        memberId: "user-1",
        payload: {},
        resourcePath: User.resourcePath()
      })

      expect(calls[0].body.requests[0].customPath).toEqual("/users/user-1/refresh-access")
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("routes path-based frontend-model commands through the shared frontend-model API when shared transport is enabled", async () => {
    const User = buildTestModelClass()
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    try {
      FrontendModelBase.configureTransport({shared: true})
      stubSharedFrontendModelFetch(calls, {models: [{email: "john@example.com", id: 5, name: "John"}], status: "success"})

      const users = await User.toArray()

      expectSharedIndexRequest(calls)
      expect(calls[0].body.requests[0].model).toEqual("User")
      expect(users[0].id()).toEqual(5)
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("supports explicit load() on frontend model classes", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      models: [{email: "john@example.com", id: 5, name: "John"}]
    })

    try {
      const users = await User.load()

      expect(fetchStub.calls).toEqual([{
        body: {},
        url: "/frontend-models"
      }])
      expect(users[0].id()).toEqual(5)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("batches shared frontend-model API requests through a websocket client", async () => {
    const User = buildTestModelClass()
    /** @type {Array<{body: Record<string, any>, path: string}>} */
    const calls = []

    FrontendModelBase.configureTransport({
      shared: true,
      url: "https://example.test",
      websocketClient: {
        post: async (path, body) => {
          calls.push({
            body,
            path
          })

          return {
            json: () => ({
              responses: (body.requests || []).map((requestEntry) => ({
                requestId: requestEntry.requestId,
                response: {models: [{email: "john@example.com", id: "5", name: "John"}], status: "success"}
              })),
              status: "success"
            })
          }
        }
      }
    })

    try {
      const [firstResult, secondResult] = await Promise.all([
        User.toArray(),
        User.toArray()
      ])

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toEqual("/frontend-models")
      expect(calls[0].body.requests).toHaveLength(2)
      expect(firstResult[0].id()).toEqual("5")
      expect(secondResult[0].name()).toEqual("John")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("uses configured frontend-model primary keys", () => {
    const User = buildCustomPrimaryKeyTestModelClass()
    const user = new User({name: "Jane", reference: "user-ref-1"})

    expect(User.primaryKey()).toEqual("reference")
    expect(user.primaryKeyValue()).toEqual("user-ref-1")
  })

  it("uses configured shared frontend-model API URL when url is configured", async () => {
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    FrontendModelBase.configureTransport({
      url: "https://example.test"
    })

    try {
      const SharedApiUser = buildSharedApiTestModelClass("SharedApiUser")

      stubSharedFrontendModelFetch(calls, {models: [{id: "1", name: "One"}], status: "success"})

      await SharedApiUser.toArray()

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toEqual("https://example.test/frontend-models")
    } finally {
      resetFrontendModelTransport()
      globalThis.fetch = originalFetch
    }
  })

  it("loads model collection with toArray", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{email: "john@example.com", id: 5, name: "John"}]})

    try {
      const users = await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "/frontend-models"
        }
      ])
      expect(users.length).toEqual(1)
      expect(users[0].id()).toEqual(5)
      expect(users[0].name()).toEqual("John")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("returns model count with count", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      count: 2
    })

    try {
      const usersCount = await User.count()

      expect(fetchStub.calls).toEqual([
        {
          body: {count: true},
          url: "/frontend-models"
        }
      ])
      expect(usersCount).toEqual(2)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends relationship-path where payload when using where(...).toArray()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .where({project: {creatingUser: {reference: "creator-1"}}})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            where: {project: {creatingUser: {reference: "creator-1"}}}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends deterministic primary-key ordering when using first()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{email: "john@example.com", id: 5, name: "John"}]})

    try {
      const user = await User.first()

      expectPrimaryKeyFirstRequest(fetchStub)
      expect(user?.id()).toEqual(5)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports order alias by forwarding to sort payload", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .order("name desc")
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            sort: [
              {
                column: "name",
                direction: "desc",
                path: []
              }
            ]
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("reverses explicit ordering when using last()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{email: "john@example.com", id: 5, name: "John"}]})

    try {
      const user = await User
        .sort("-id")
        .last()

      expectPrimaryKeyFirstRequest(fetchStub)
      expect(user?.id()).toEqual(5)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("keeps pagination scope when using last()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      models: [
        {email: "jane@example.com", id: 6, name: "Jane"},
        {email: "john@example.com", id: 7, name: "John"}
      ]
    })

    try {
      const user = await User
        .sort("id asc")
        .offset(1)
        .last()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            offset: 1,
            sort: [
              {
                column: "id",
                direction: "asc",
                path: []
              }
            ]
          },
          url: "/frontend-models"
        }
      ])
      expect(user?.id()).toEqual(7)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("normalizes symbolic search operators when using search(...).toArray()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      const oneDayAgo = new Date("2026-02-24T10:00:00.000Z")

      await User
        .search([], "createdAt", ">=", oneDayAgo)
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            searches: [
              {
                column: "createdAt",
                operator: "gteq",
                path: [],
                value: {__velocious_type: "date", value: "2026-02-24T10:00:00.000Z"}
              }
            ]
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends relationship-path searches payload when using search(...).count()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({count: 2})

    try {
      const oneDayAgo = new Date("2026-02-24T10:00:00.000Z")
      const usersCount = await User
        .search(["accountUsers", "account"], "createdAt", "gteq", oneDayAgo)
        .count()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            count: true,
            searches: [
              {
                column: "createdAt",
                operator: "gteq",
                path: ["accountUsers", "account"],
                value: {__velocious_type: "date", value: "2026-02-24T10:00:00.000Z"}
              }
            ]
          },
          url: "/frontend-models"
        }
      ])
      expect(usersCount).toEqual(2)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends ransack payload when using ransack(...).toArray()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .ransack({email_cont: "john", id_in: ["1", "2"]})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            ransack: {email_cont: "john", id_in: ["1", "2"]}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("omits model serialization payload when using count()", async () => {
    const {Project} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({count: 1})

    try {
      const projectsCount = await Project
        .preload(["tasks"])
        .select({
          Project: ["id"],
          Task: ["id"]
        })
        .where({id: 1})
        .order("name")
        .count()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            count: true,
            where: {id: 1}
          },
          url: "/frontend-models"
        }
      ])
      expect(projectsCount).toEqual(1)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends pagination payload when using count()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({count: 5})

    try {
      const usersCount = await User
        .limit(5)
        .offset(10)
        .count()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            count: true,
            limit: 5,
            offset: 10
          },
          url: "/frontend-models"
        }
      ])
      expect(usersCount).toEqual(5)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("throws when using ransack with an unknown attribute", async () => {
    const User = buildTestModelClass()
    const sevenDaysAgo = new Date("2026-02-24T10:00:00.000Z")

    await expect(async () => {
      await User
        .ransack({unknown_column_gteq: sevenDaysAgo})
        .count()
    }).toThrow('Unknown ransack attribute "unknown_column" for User')
  })

  it("supports snake_case and camelCase ransack keys", async () => {
    const User = buildCreatedAtTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      const sevenDaysAgo = new Date("2026-02-24T10:00:00.000Z")

      await User
        .ransack({created_at_gteq: sevenDaysAgo})
        .toArray()

      await User
        .ransack({createdAtGteq: sevenDaysAgo})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            ransack: {created_at_gteq: {__velocious_type: "date", value: "2026-02-24T10:00:00.000Z"}}
          },
          url: "/frontend-models"
        },
        {
          body: {
            ransack: {createdAtGteq: {__velocious_type: "date", value: "2026-02-24T10:00:00.000Z"}}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("chains ransack filters onto existing frontend-model queries", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .where({id: "2"})
        .ransack({email_cont: "john"})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            ransack: {email_cont: "john"},
            where: {id: "2"}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("applies sort from ransack s param", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .ransack({s: "name asc", emailCont: "john"})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            ransack: {emailCont: "john"},
            sort: [{column: "name", direction: "asc", path: []}]
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("ignores blank ransack s param", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .ransack({s: "", emailCont: "john"})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            ransack: {emailCont: "john"}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports multi-column ransack sort", async () => {
    const User = buildCreatedAtTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .ransack({s: "id asc, createdAt desc"})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            sort: [
              {column: "id", direction: "asc", path: []},
              {column: "createdAt", direction: "desc", path: []}
            ]
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("throws for unknown ransack sort attribute", async () => {
    const User = buildTestModelClass()

    await expect(async () => {
      await User
        .ransack({s: "nonexistent asc"})
        .toArray()
    }).toThrow('Unknown ransack sort attribute "nonexistent" for User')
  })

  it("sends group payload when using group(...).toArray()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      await User
        .group({
          project: {
            account: ["id"]
          }
        })
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            group: [
              {
                column: "id",
                path: ["project", "account"]
              }
            ]
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends joins payload when using joins(...).toArray()", async () => {
    const {Task} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({models: []})

    try {
      await Task
        .joins({project: {tasks: true}})
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            joins: {
              project: {
                tasks: true
              }
            }
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("rejects raw string joins definitions", async () => {
    const User = buildTestModelClass()

    await expect(async () => {
      await User.joins("LEFT JOIN accounts ON accounts.id = users.account_id").toArray()
    }).toThrow(/Invalid joins type/)
  })

  it("rejects unsafe string group definitions", async () => {
    const User = buildTestModelClass()

    await expect(async () => {
      await User.group("id; DROP TABLE accounts").toArray()
    }).toThrow(/Invalid group column/)
  })

  it("sends pluck payload when using pluck(...)", async () => {
    const {Task} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({status: "success", values: ["project-1"]})

    try {
      const values = await Task.pluck({project: ["id"]})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            pluck: [
              {
                column: "id",
                path: ["project"]
              }
            ]
          },
          url: "/frontend-models"
        }
      ])
      expect(values).toEqual(["project-1"])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("rejects unsafe string pluck definitions", async () => {
    const User = buildTestModelClass()

    await expect(async () => {
      await User.pluck("id; DROP TABLE accounts")
    }).toThrow(/Invalid pluck column/)
  })

  it("rejects unknown pluck relationships", async () => {
    const User = buildTestModelClass()

    await expect(async () => {
      await User.pluck({project: ["id"]})
    }).toThrow(/Unknown pluck relationship/)
  })

  it("rejects unknown pluck columns", async () => {
    const {Task} = buildPreloadTestModelClasses()

    await expect(async () => {
      await Task.pluck("unknownColumn")
    }).toThrow(/Unknown pluck column/)
  })


  it("finds a model and maps response attributes", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{email: "john@example.com", id: 5, name: "John"}]})

    try {
      const user = await User.find(5)

      expect(user.id()).toEqual(5)
      expect(user.name()).toEqual("John")
    } finally {
      restoreFrontendModelFetch(fetchStub)
    }
  })

  it("raises when backend returns an error status payload", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({errorMessage: "Task not found.", status: "error"})

    try {
      await expect(async () => {
        await User.find(123)
      }).toThrow(/Task not found./)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("raises debug error messages from non-production error status payloads", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({debugErrorMessage: "Database relation is missing.", errorMessage: "Request failed.", status: "error"})

    try {
      await expect(async () => {
        await User.find(123)
      }).toThrow(/Database relation is missing\./)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("does not treat raw model status attributes as command errors for fetch transport", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{id: 5, name: "Domain status model", status: "error"}]})

    try {
      const user = await User.find(5)

      expect(user.id()).toEqual(5)
      expect(user.name()).toEqual("Domain status model")
      expect(user.readAttribute("status")).toEqual("error")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("serializes Date/undefined/bigint/non-finite values and deserializes marker responses", async () => {
    const User = buildTestModelClass()
    const requestDate = new Date("2026-02-20T12:00:00.000Z")
    const responseDateString = "2026-02-21T10:30:00.000Z"
    const fetchStub = stubFetch({
      nested: {
        hugeCounter: {__velocious_type: "bigint", value: "9007199254740993"},
        missing: {__velocious_type: "undefined"},
        negativeInfinity: {__velocious_type: "number", value: "-Infinity"},
        notANumber: {__velocious_type: "number", value: "NaN"},
        positiveInfinity: {__velocious_type: "number", value: "Infinity"},
        when: {__velocious_type: "date", value: responseDateString}
      }
    })

    try {
      const response = await User.executeCommand("find", {
        hugeCounter: 9007199254740993n,
        id: 5,
        missing: undefined,
        nested: {
          hugeCounter: 9007199254740995n,
          missing: undefined,
          negativeInfinity: Number.NEGATIVE_INFINITY,
          notANumber: Number.NaN,
          positiveInfinity: Number.POSITIVE_INFINITY,
          when: requestDate
        }
      })

      expect(fetchStub.calls).toEqual([
        {
          body: {
            hugeCounter: {__velocious_type: "bigint", value: "9007199254740993"},
            id: 5,
            missing: {__velocious_type: "undefined"},
            nested: {
              hugeCounter: {__velocious_type: "bigint", value: "9007199254740995"},
              missing: {__velocious_type: "undefined"},
              negativeInfinity: {__velocious_type: "number", value: "-Infinity"},
              notANumber: {__velocious_type: "number", value: "NaN"},
              positiveInfinity: {__velocious_type: "number", value: "Infinity"},
              when: {__velocious_type: "date", value: "2026-02-20T12:00:00.000Z"}
            }
          },
          url: "/frontend-models"
        }
      ])
      expect(response.nested.hugeCounter).toEqual(9007199254740993n)
      expect(response.nested.missing).toEqual(undefined)
      expect(response.nested.positiveInfinity).toEqual(Number.POSITIVE_INFINITY)
      expect(response.nested.negativeInfinity).toEqual(Number.NEGATIVE_INFINITY)
      expect(Number.isNaN(response.nested.notANumber)).toEqual(true)
      expect(response.nested.when instanceof Date).toEqual(true)
      expect(response.nested.when.toISOString()).toEqual(responseDateString)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("findBy matches objects by exact own-key equality", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      models: [
        {id: 1, metadata: {region: "eu", tier: "pro"}, name: "Superset"},
        {id: 2, metadata: {region: "eu"}, name: "Exact"}
      ]
    })

    try {
      const user = await User.findBy({metadata: {region: "eu"}})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            where: {
              metadata: {region: "eu"}
            }
          },
          url: "/frontend-models"
        }
      ])
      expect(user?.id()).toEqual(2)
      expect(user?.name()).toEqual("Exact")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("findBy matches Date conditions when response values deserialize to Date objects", async () => {
    const User = buildTestModelClass()
    const conditionDate = new Date("2026-02-20T12:00:00.000Z")
    const fetchStub = stubFetch({
      models: [
        {
          createdAt: {__velocious_type: "date", value: "2026-02-20T12:00:00.000Z"},
          id: 5,
          name: "John"
        }
      ]
    })

    try {
      const user = await User.findBy({createdAt: conditionDate})

      expect(user?.id()).toEqual(5)
      expect(user?.name()).toEqual("John")
    } finally {
      restoreFrontendModelFetch(fetchStub)
    }
  })

  it("includes condition keys in select payload for findBy matching", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      models: [
        {email: "john@example.com", id: 5}
      ]
    })

    try {
      const user = await User
        .select({
          User: ["id"]
        })
        .findBy({email: "john@example.com"})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            select: {
              User: ["id", "email"]
            },
            where: {
              email: "john@example.com"
            }
          },
          url: "/frontend-models"
        }
      ])
      expect(user?.id()).toEqual(5)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("auto-selects primary key for selected root model find and keeps destroy working", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{email: "john@example.com", id: 5}]})

    try {
      const user = await User
        .select({
          User: ["email"]
        })
        .find(5)

      expect(user.id()).toEqual(5)
      await user.destroy()
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("includes preload payload and hydrates nested relationship models", async () => {
    const {Project} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({
      models: [
        {
          id: "1",
          name: "One",
          __preloadedRelationships: {
            tasks: [
              {
                id: "11",
                name: "Task 1",
                __preloadedRelationships: {
                  comments: [
                    {body: "Comment 1", id: "101"}
                  ]
                }
              }
            ]
          }
        }
      ]
    })

    try {
      const projects = await Project
        .preload({tasks: ["comments"]})
        .toArray()
      const tasks = projects[0].getRelationshipByName("tasks").loaded()
      const commentsForFirstTask = tasks[0].getRelationshipByName("comments").loaded()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            preload: {
              tasks: {
                comments: true
              }
            }
          },
          url: "/frontend-models"
        }
      ])
      expect(tasks[0].constructor.name).toEqual("Task")
      expect(commentsForFirstTask[0].constructor.name).toEqual("Comment")

      await expect(async () => {
        tasks[0].primaryInteraction()
      }).toThrow(/Task#primaryInteraction hasn't been preloaded/)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("includes select payload when querying frontend models", async () => {
    const {Project} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({models: []})

    try {
      await Project
        .preload(["tasks"])
        .select({
          Project: ["id", "createdAt"],
          Task: ["updatedAt"]
        })
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            preload: {
              tasks: true
            },
            select: {
              Project: ["id", "createdAt"],
              Task: ["updatedAt"]
            }
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("treats select array shorthand as root-model attributes", async () => {
    const {Project} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({models: []})

    try {
      await Project
        .joins({tasks: true})
        .select(["id", "createdAt"])
        .toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            joins: {
              tasks: true
            },
            select: {
              Project: ["id", "createdAt"]
            }
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("raises AttributeNotSelectedError for non-selected attributes", async () => {
    const {Project} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({
      models: [
        {
          id: "1",
          __preloadedRelationships: {
            tasks: [
              {
                updatedAt: "2026-02-20T10:00:00.000Z"
              }
            ]
          }
        }
      ]
    })

    try {
      const projects = await Project
        .preload(["tasks"])
        .select({
          Project: ["id"],
          Task: ["updatedAt"]
        })
        .toArray()
      const tasks = projects[0].getRelationshipByName("tasks").loaded()
      const firstTask = tasks[0]

      expect(firstTask.readAttribute("updatedAt")).toEqual("2026-02-20T10:00:00.000Z")

      let thrownError = null

      try {
        firstTask.readAttribute("id")
      } catch (error) {
        thrownError = error
      }

      expect(thrownError instanceof AttributeNotSelectedError).toEqual(true)
      expect(String(thrownError)).toMatch(/Task#id was not selected/)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports build() for has-many relationship helpers", () => {
    const {Project} = buildPreloadTestModelClasses()
    const project = new Project({id: "1"})
    const builtTask = project.getRelationshipByName("tasks").build({id: "11", name: "Task 1"})
    const loadedTasks = project.getRelationshipByName("tasks").loaded()

    expect(builtTask.readAttribute("id")).toEqual("11")
    expect(loadedTasks.length).toEqual(1)
    expect(loadedTasks[0]).toEqual(builtTask)
  })

  it("supports loading and setting relationships from parity helpers", async () => {
    const {fetchStub, project} = buildProjectTasksPreloadFixture()
    const {Task} = buildPreloadTestModelClasses()
    const task = new Task({id: "11", name: "Task 1"})

    try {
      const loadedTasks = await project.loadRelationship("tasks")
      expect(Array.isArray(loadedTasks)).toEqual(true)
      expect(loadedTasks[0].readAttribute("id")).toEqual("11")

      const assignedProject = task.setRelationship("project", project)

      expect(assignedProject).toEqual(project)
      expect(task.getRelationshipByName("project").loaded()).toEqual(project)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("reuses preloaded frontend relationships before loading again", async () => {
    const {Project, Task} = buildPreloadTestModelClasses()
    const preloadedProject = new Project({id: "1", name: "One"})
    const task = Task.instantiateFromResponse({
      id: "11",
      name: "Task 1",
      __preloadedRelationships: {
        project: {
          id: "1",
          name: "One"
        }
      }
    })
    const fetchStub = stubFetch({
      model: {
        id: "11",
        name: "Task 1",
        __preloadedRelationships: {
          project: {
            id: "2",
            name: "Two"
          }
        }
      }
    })

    try {
      const project = await task.relationshipOrLoad("project")

      expect(project?.readAttribute("id")).toEqual(preloadedProject.readAttribute("id"))
      expect(fetchStub.calls).toEqual([])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("reuses in-memory singular frontend relationships before loading again", async () => {
    const {Project, Task} = buildPreloadTestModelClasses()
    const task = new Task({id: "11", name: "Task 1"})
    const assignedProject = task.setRelationship("project", new Project({id: "1", name: "One"}))
    const fetchStub = stubFetch({
      model: {
        id: "11",
        name: "Task 1",
        __preloadedRelationships: {
          project: {
            id: "2",
            name: "Two"
          }
        }
      }
    })

    try {
      const project = await task.relationshipOrLoad("project")

      expect(project).toEqual(assignedProject)
      expect(fetchStub.calls).toEqual([])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports lazy toArray() and explicit load() for has-many frontend relationships", async () => {
    const {fetchStub, project} = buildProjectTasksPreloadFixture()

    try {
      const loadedTasks = await project.getRelationshipByName("tasks").toArray()
      const cachedTasks = await project.getRelationshipByName("tasks").toArray()
      const reloadedTasks = await project.getRelationshipByName("tasks").load()

      expect(loadedTasks.map((task) => task.readAttribute("id"))).toEqual(["11"])
      expect(cachedTasks.map((task) => task.readAttribute("id"))).toEqual(["11"])
      expect(reloadedTasks.map((task) => task.readAttribute("id"))).toEqual(["11"])
      expect(fetchStub.calls).toEqual([
        {
          body: {
            preload: {
              tasks: true
            },
            where: {id: "1"}
          },
          url: "/frontend-models"
        },
        {
          body: {
            preload: {
              tasks: true
            },
            where: {id: "1"}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("reuses in-memory has-many frontend relationships before querying again", async () => {
    const {Project} = buildPreloadTestModelClasses()
    const project = new Project({id: "1", name: "One"})
    const builtTask = project.getRelationshipByName("tasks").build({id: "11", name: "Task 1"})
    const fetchStub = stubFetch({
      models: [{
        id: "1",
        name: "One",
        __preloadedRelationships: {
          tasks: [
            {id: "22", name: "Task 2"}
          ]
        }
      }]
    })

    try {
      const loadedTasks = await project.getRelationshipByName("tasks").toArray()

      expect(loadedTasks).toEqual([builtTask])
      expect(fetchStub.calls).toEqual([])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("clears cached preloaded relationships when attributes change", () => {
    const {Task} = buildPreloadTestModelClasses()
    const task = Task.instantiateFromResponse({
      id: "11",
      name: "Task one",
      projectId: "1",
      __preloadedRelationships: {
        project: {
          id: "1",
          name: "Project one"
        }
      }
    })

    expect(task.getRelationshipByName("project").loaded().readAttribute("id")).toEqual("1")

    task.setAttribute("projectId", "2")

    expect(() => {
      task.getRelationshipByName("project").loaded()
    }).toThrow(/Task#project hasn't been preloaded/)
  })

  it("keeps cached preloaded relationships when attribute value does not change", () => {
    const {Task} = buildPreloadTestModelClasses()
    const task = Task.instantiateFromResponse({
      id: "11",
      name: "Task one",
      projectId: "1",
      __preloadedRelationships: {
        project: {
          id: "1",
          name: "Project one"
        }
      }
    })
    const beforeProject = task.getRelationshipByName("project").loaded()

    task.setAttribute("projectId", "1")

    expect(task.getRelationshipByName("project").loaded()).toEqual(beforeProject)
  })

  it("returns an already-hydrated instance unchanged when passed to instantiateFromResponse", () => {
    const User = buildTestModelClass()
    const original = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})
    // Auto-serialized custom-command responses arrive at call sites as
    // already-hydrated models, so wrapping them in a second
    // `Model.instantiateFromResponse(...)` call must be a no-op rather
    // than spreading internal state into a freshly constructed model.
    const passthrough = User.instantiateFromResponse(original)

    expect(passthrough).toBe(original)
    expect(passthrough.name()).toEqual("John")
  })

  it("updates a model and refreshes local attributes", async () => {
    const {fetchStub, user} = buildUserUpdateResponseFixture()

    try {
      await user.update({name: "John Changed"})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {name: "John Changed"},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
      expect(user.name()).toEqual("Johnny")
      expect(user.readAttribute("email")).toEqual("johnny@example.com")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("includes previously staged attributes in update payloads", async () => {
    const {fetchStub, user} = buildUserUpdateResponseFixture()

    try {
      user.setAttribute("email", "staged@example.com")

      await user.update({name: "John Changed"})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "staged@example.com", name: "John Changed"},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("does not include unchanged read-only response attributes in update payloads", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5, membersCount: 2, name: "John"}})
    const user = User.instantiateFromResponse({email: "john@example.com", id: 5, membersCount: 2, name: "John"})

    try {
      await user.update({name: "John Changed"})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {name: "John Changed"},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("updates attachments using update attachment attributes", async () => {
    const Task = buildAttachmentTestModelClass()
    const fetchStub = stubFetch({model: {id: 10, name: "Task"}})
    const task = Task.instantiateFromResponse({id: 10, name: "Task"})

    try {
      await task.update({
        descriptionFile: {
          contentBase64: "YQ==",
          filename: "a.txt"
        }
      })

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attachments: {
              descriptionFile: {
                contentBase64: "YQ==",
                contentType: null,
                filename: "a.txt"
              }
            },
            attributes: {},
            id: 10
          },
          url: "/tasks/update"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("falls back to direct HTTP attachment uploads for attachment updates when shared websocket transport is enabled", async () => {
    const {fetchCalls, restore, task, websocketCalls} = buildSharedWebsocketAttachmentFixture()

    try {
      await task.update({
        descriptionFile: {
          contentBase64: "YQ==",
          filename: "a.txt"
        }
      })

      expect(websocketCalls).toEqual([])
      expect(fetchCalls).toEqual([
        {
          body: {
            attachments: {
              descriptionFile: {
                contentBase64: "YQ==",
                contentType: null,
                filename: "a.txt"
              }
            },
            attributes: {},
            id: 10
          },
          url: "/tasks/update"
        }
      ])
    } finally {
      restore()
    }
  })

  it("downloads attachments through attachment helpers", async () => {
    const Task = buildAttachmentTestModelClass()
    const fetchStub = stubFetch({
      attachment: {
        byteSize: 1,
        contentBase64: "YQ==",
        contentType: "text/plain",
        filename: "a.txt",
        id: "attachment-1",
        url: "file:///tmp/attachments/attachment-1-a.txt"
      }
    })
    const task = new Task({id: 11, name: "Task"})

    try {
      const downloadedAttachment = await task.descriptionFile().download()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attachmentName: "descriptionFile",
            id: 11
          },
          url: "/frontend-models"
        }
      ])
      expect(downloadedAttachment.filename()).toEqual("a.txt")
      expect(Array.from(downloadedAttachment.content())).toEqual([97])
      expect(downloadedAttachment.url()).toEqual("file:///tmp/attachments/attachment-1-a.txt")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("loads attachment URLs through attachment helpers", async () => {
    const Task = buildAttachmentTestModelClass()
    const fetchStub = stubFetch({
      status: "success",
      url: "file:///tmp/attachments/attachment-2-a.txt"
    })
    const task = new Task({id: 11, name: "Task"})

    try {
      const attachmentUrl = await task.descriptionFile().url()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attachmentName: "descriptionFile",
            id: 11
          },
          url: "/frontend-models"
        }
      ])
      expect(attachmentUrl).toEqual("file:///tmp/attachments/attachment-2-a.txt")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("rejects path attachment input for frontend models", async () => {
    const Task = buildAttachmentTestModelClass()
    const fetchStub = stubFetch({model: {id: 11, name: "Task"}})
    const task = new Task({id: 11, name: "Task"})

    try {
      await expect(async () => {
        await task.descriptionFile().attach({path: "/tmp/file.txt"})
      }).toThrow("Attachment path input is not supported in frontend models")

      expect(fetchStub.calls).toEqual([])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("falls back to direct HTTP for attachment uploads when shared websocket transport is enabled", async () => {
    const {fetchCalls, restore, task, websocketCalls} = buildSharedWebsocketAttachmentFixture()

    try {
      await task.descriptionFile().attach({
        contentBase64: "YQ==",
        filename: "a.txt"
      })

      expect(websocketCalls).toEqual([])
      expectAttachmentUploadFetchCalls(fetchCalls)
    } finally {
      restore()
    }
  })

  it("saves a new model with create command and tracks persisted state", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 7, name: "Created"}})
    const user = new User({email: "john@example.com", name: "Draft"})

    try {
      expect(user.isNewRecord()).toEqual(true)
      expect(user.isPersisted()).toEqual(false)

      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "john@example.com", name: "Draft"}
          },
          url: "/frontend-models"
        }
      ])
      expect(user.isNewRecord()).toEqual(false)
      expect(user.isPersisted()).toEqual(true)
      expect(user.id()).toEqual(7)
      expect(user.isChanged()).toEqual(false)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("offline save queues a local create mutation and applies optimistic persisted state without network", async () => {
    const User = buildOfflineSyncTestModelClass({operations: ["create", "update", "destroy"]})
    const fetchStub = stubFetch({model: {email: "network@example.com", id: 99, name: "Network"}})
    const mutationLog = new LocalMutationLog({
      idGenerator: () => "log-1",
      now: nextNow(["2026-06-24T10:00:00.000Z"]),
      storage: buildMemoryStorage()
    })
    const user = new User({email: "offline@example.com", name: "Offline"})

    try {
      FrontendModelBase.configureTransport({
        offlineSync: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          clientMutationId: () => "mutation-1",
          enabled: true,
          mutationLog,
          now: () => new Date("2026-06-24T09:59:59.000Z"),
          offlineGrant: {id: "grant-1"}
        }
      })

      await user.save()

      expect(fetchStub.calls).toEqual([])
      expect(user.isNewRecord()).toEqual(false)
      expect(user.id()).toEqual("mutation-1")
      expect(user.isChanged()).toEqual(false)
      expect(await mutationLog.records()).toEqual([{
        createdAt: "2026-06-24T10:00:00.000Z",
        dependencies: [],
        id: "log-1",
        mutation: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          attributes: {email: "offline@example.com", id: "mutation-1", name: "Offline"},
          baseVersion: null,
          clientMutationId: "mutation-1",
          model: "User",
          occurredAt: "2026-06-24T09:59:59.000Z",
          offlineGrantId: "grant-1",
          operation: "create",
          policyHash: "sha256-user"
        },
        sequence: 1,
        status: "pending",
        updatedAt: "2026-06-24T10:00:00.000Z"
      }])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("offline update queues changed attributes with the primary key", async () => {
    const User = buildOfflineSyncTestModelClass({operations: ["update"]})
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5, name: "Network"}})
    const mutationLog = new LocalMutationLog({
      idGenerator: () => "log-1",
      now: () => new Date("2026-06-24T10:00:00.000Z"),
      storage: buildMemoryStorage()
    })
    const user = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})

    try {
      FrontendModelBase.configureTransport({
        offlineSync: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          clientMutationId: () => "mutation-1",
          enabled: true,
          mutationLog,
          now: () => new Date("2026-06-24T09:59:59.000Z"),
          offlineGrant: {id: "grant-1"}
        }
      })
      user.setAttribute("name", "Offline Renamed")

      await user.save()

      expect(fetchStub.calls).toEqual([])
      expect(user.isChanged()).toEqual(false)
      expect((await mutationLog.records())[0].mutation).toEqual({
        actorDeviceId: "device-1",
        actorUserId: "user-1",
        attributes: {id: 5, name: "Offline Renamed"},
        baseVersion: null,
        clientMutationId: "mutation-1",
        model: "User",
        occurredAt: "2026-06-24T09:59:59.000Z",
        offlineGrantId: "grant-1",
        operation: "update",
        policyHash: "sha256-user"
      })
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("offline save rejects nested attributes without clearing queued nested state", async () => {
    const {Project} = buildOfflineNestedSyncTestClasses()
    const fetchStub = stubFetch({model: {id: 7, name: "Launch"}})
    const mutationLog = new LocalMutationLog({storage: buildMemoryStorage()})
    const project = new Project({name: "Launch"})
    project.getRelationshipByName("tasks").build({name: "Design"})

    try {
      FrontendModelBase.configureTransport({
        offlineSync: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          enabled: true,
          mutationLog,
          offlineGrant: {id: "grant-1"}
        }
      })

      await expect(async () => {
        await project.save()
      }).toThrow("Offline sync for Project does not support nested attributes or attachments yet")
      expect(await mutationLog.records()).toEqual([])

      FrontendModelBase.configureTransport({offlineSync: undefined})
      await project.save()

      expect(fetchStub.calls[0].body.nestedAttributes).toEqual({tasks: [{attributes: {name: "Design"}}]})
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("offline save rejects attachments without clearing queued attachment state", async () => {
    const Task = buildOfflineAttachmentSyncTestModelClass()
    const fetchStub = stubFetch({model: {id: 5, name: "Task"}})
    const mutationLog = new LocalMutationLog({storage: buildMemoryStorage()})
    const task = Task.instantiateFromResponse({id: 5, name: "Task"})

    try {
      FrontendModelBase.configureTransport({
        offlineSync: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          enabled: true,
          mutationLog,
          offlineGrant: {id: "grant-1"}
        }
      })

      await expect(async () => {
        await task.update({descriptionFile: {contentBase64: "YQ==", filename: "a.txt"}})
      }).toThrow("Offline sync for Task does not support nested attributes or attachments yet")
      expect(await mutationLog.records()).toEqual([])

      FrontendModelBase.configureTransport({offlineSync: undefined})
      await task.save()

      expect(fetchStub.calls[0].body.attachments).toEqual({
        descriptionFile: {
          contentBase64: "YQ==",
          contentType: null,
          filename: "a.txt"
        }
      })
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("offline save rejects writes not allowed by the local sync policy", async () => {
    const User = buildOfflineSyncTestModelClass({operations: ["find", "index"]})
    const mutationLog = new LocalMutationLog({storage: buildMemoryStorage()})
    const user = new User({email: "offline@example.com", name: "Offline"})

    try {
      FrontendModelBase.configureTransport({
        offlineSync: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          enabled: true,
          mutationLog,
          offlineGrant: {id: "grant-1"}
        }
      })

      await expect(async () => {
        await user.save()
      }).toThrow("Offline sync for User does not allow create")
      expect(await mutationLog.records()).toEqual([])
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("offline destroy queues a local destroy mutation without network", async () => {
    const User = buildOfflineSyncTestModelClass({operations: ["destroy"]})
    const fetchStub = stubFetch({status: "success"})
    const mutationLog = new LocalMutationLog({
      idGenerator: () => "log-1",
      now: () => new Date("2026-06-24T10:00:00.000Z"),
      storage: buildMemoryStorage()
    })
    const user = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})

    try {
      FrontendModelBase.configureTransport({
        offlineSync: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          clientMutationId: () => "mutation-1",
          enabled: true,
          mutationLog,
          now: () => new Date("2026-06-24T09:59:59.000Z"),
          offlineGrant: {id: "grant-1"}
        }
      })

      await user.destroy()

      expect(fetchStub.calls).toEqual([])
      expect(await mutationLog.records()).toEqual([{
        createdAt: "2026-06-24T10:00:00.000Z",
        dependencies: [],
        id: "log-1",
        mutation: {
          actorDeviceId: "device-1",
          actorUserId: "user-1",
          attributes: {id: 5},
          baseVersion: null,
          clientMutationId: "mutation-1",
          model: "User",
          occurredAt: "2026-06-24T09:59:59.000Z",
          offlineGrantId: "grant-1",
          operation: "destroy",
          policyHash: "sha256-user"
        },
        sequence: 1,
        status: "pending",
        updatedAt: "2026-06-24T10:00:00.000Z"
      }])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() on the update path sends only changed attributes, never framework-managed fields", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5, name: "John Changed"}})
    const user = User.instantiateFromResponse({createdAt: "2026-01-01T00:00:00.000Z", email: "john@example.com", id: 5, name: "John", updatedAt: "2026-01-02T00:00:00.000Z"})

    try {
      user.setName("John Changed")

      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {name: "John Changed"},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
      expect(user.isChanged()).toEqual(false)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() on the update path with no changes sends an empty attributes hash", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5, name: "John"}})
    const user = User.instantiateFromResponse({createdAt: "2026-01-01T00:00:00.000Z", email: "john@example.com", id: 5, name: "John", updatedAt: "2026-01-02T00:00:00.000Z"})

    try {
      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() on the update path sends only the subset of attributes touched by setters", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "renamed@example.com", id: 5, name: "Renamed"}})
    const user = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})

    try {
      user.setName("Renamed")
      user.setAttribute("email", "renamed@example.com")

      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "renamed@example.com", name: "Renamed"},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() on the create path still sends every assigned attribute", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "draft@example.com", id: 9, name: "Draft"}})
    const user = new User({email: "draft@example.com", name: "Draft"})

    try {
      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "draft@example.com", name: "Draft"}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() on the create path does not send unchanged attributes", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "draft@example.com", id: 9, name: "Draft", userId: 12}})
    const user = new User()

    try {
      user.setUserId(null)
      user.markAttributeUnchanged("userId")
      user.setEmail("draft@example.com")
      user.setName("Draft")
      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "draft@example.com", name: "Draft"}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() on the create path omits null attributes that were never explicitly persisted", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "draft@example.com", id: 9, name: "Draft", userId: 12}})
    const user = new User({userId: null})

    try {
      user.setEmail("draft@example.com")
      user.setName("Draft")
      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "draft@example.com", name: "Draft"}
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("save() resets dirty tracking after a successful update so the next save sends nothing extra", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5, name: "Renamed"}})
    const user = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})

    try {
      user.setName("Renamed")
      await user.save()
      await user.save()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {name: "Renamed"},
            id: 5
          },
          url: "/frontend-models"
        },
        {
          body: {
            attributes: {},
            id: 5
          },
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("_changedAttributesForSave returns the dirty subset only", () => {
    const User = buildTestModelClass()
    const user = User.instantiateFromResponse({email: "john@example.com", id: 5, name: "John"})

    expect(user._changedAttributesForSave()).toEqual({})

    user.setName("Renamed")

    expect(user._changedAttributesForSave()).toEqual({name: "Renamed"})

    user.setAttribute("email", "renamed@example.com")

    expect(user._changedAttributesForSave()).toEqual({email: "renamed@example.com", name: "Renamed"})
  })

  it("tracks changes and supports findOrInitializeBy/findOrCreateBy", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      models: [],
      model: {email: "new@example.com", id: 9, name: "Created"}
    })

    try {
      const initializedUser = await User.findOrInitializeBy({email: "new@example.com"})

      expect(initializedUser.isNewRecord()).toEqual(true)
      expect(initializedUser.isPersisted()).toEqual(false)
      expect(initializedUser.changes()).toEqual({
        email: [undefined, "new@example.com"]
      })

      const createdUser = await User.findOrCreateBy({email: "new@example.com"}, (model) => {
        model.setName("Local Name")
      })

      expect(fetchStub.calls).toEqual([
        {
          body: {
            where: {
              email: "new@example.com"
            }
          },
          url: "/frontend-models"
        },
        {
          body: {
            where: {
              email: "new@example.com"
            }
          },
          url: "/frontend-models"
        },
        {
          body: {
            attributes: {
              email: "new@example.com",
              name: "Local Name"
            }
          },
          url: "/frontend-models"
        }
      ])
      expect(createdUser.isPersisted()).toEqual(true)
      expect(createdUser.id()).toEqual(9)
      expect(createdUser.name()).toEqual("Created")
      expect(createdUser.changes()).toEqual({})
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("validates structured conditions for findOrInitializeBy/findOrCreateBy", async () => {
    const User = buildTestModelClass()

    await expect(async () => {
      await User.findOrInitializeBy({email: undefined})
    }).toThrow(/findBy does not support undefined condition values/)

    await expect(async () => {
      await User.findOrCreateBy({email: "new@example.com", metadata: /bad-regex/})
    }).toThrow(/findBy does not support non-plain object condition values/)
  })

  it("destroys a model", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({success: true})
    const user = new User({id: 7, name: "Destroy me"})

    try {
      await user.destroy()

      expect(fetchStub.calls).toEqual([
        {
          body: {id: 7},
          url: "/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("prefixes legacy direct command URLs with configured transport URL", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    FrontendModelBase.configureTransport({
      url: "http://127.0.0.1:4501/"
    })

    try {
      await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "http://127.0.0.1:4501/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports dynamic transport URLs", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    FrontendModelBase.configureTransport({
      url: () => "http://localhost:4500/v1"
    })

    try {
      await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "http://localhost:4500/v1/frontend-models"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  describe("nested attributes", () => {
    /**
     * Build a two-level nested test graph: Project hasMany Tasks, Task hasMany Comments.
     *
     * Project declares `nestedAttributes: {tasks: {allowDestroy: true}}` and
     * Task declares `nestedAttributes: {comments: {allowDestroy: true}}` so we can
     * exercise recursive payload collection.
     * @returns {{Comment: typeof FrontendModelBase, Project: typeof FrontendModelBase, Task: typeof FrontendModelBase}} - Test classes.
     */
    function buildNestedTestClasses() {
      /** Comment frontend-model. */
      class Comment extends FrontendModelBase {
        /** @returns {{attributes: string[], primaryKey: string}} */
        static resourceConfig() {
          return {attributes: ["id", "taskId", "body"], primaryKey: "id"}
        }
        /** @returns {any} */
        id() { return this.readAttribute("id") }
        /** @returns {any} */
        body() { return this.readAttribute("body") }
        /** @param {any} v @returns {any} */
        setBody(v) { return this.setAttribute("body", v) }
      }
      /** Task frontend-model with nested comments. */
      class Task extends FrontendModelBase {
        /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} */
        static resourceConfig() {
          return {
            attachments: {descriptionFile: {type: "hasOne"}},
            attributes: ["id", "projectId", "name"],
            nestedAttributes: {comments: {allowDestroy: true}, project: {}},
            primaryKey: "id"
          }
        }
        /** @returns {Record<string, typeof FrontendModelBase>} */
        static relationshipModelClasses() { return {comments: Comment, project: Project} }
        /** @returns {Record<string, {type: "belongsTo" | "hasMany"}>} */
        static relationshipDefinitions() { return {comments: {type: "hasMany"}, project: {type: "belongsTo"}} }
        /** @returns {any} */
        id() { return this.readAttribute("id") }
        /** @returns {any} */
        name() { return this.readAttribute("name") }
        /** @param {any} v @returns {any} */
        setName(v) { return this.setAttribute("name", v) }
      }
      /** Project frontend-model with nested tasks. */
      class Project extends FrontendModelBase {
        /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} */
        static resourceConfig() {
          return {
            attributes: ["id", "name"],
            nestedAttributes: {tasks: {allowDestroy: true}},
            primaryKey: "id"
          }
        }
        /** @returns {Record<string, typeof FrontendModelBase>} */
        static relationshipModelClasses() { return {tasks: Task} }
        /** @returns {Record<string, {type: "hasMany"}>} */
        static relationshipDefinitions() { return {tasks: {type: "hasMany"}} }
        /** @returns {any} */
        id() { return this.readAttribute("id") }
        /** @returns {any} */
        name() { return this.readAttribute("name") }
        /** @param {any} v @returns {any} */
        setName(v) { return this.setAttribute("name", v) }
      }
      return {Comment, Project, Task}
    }

    it("emits nestedAttributes entries for built (new) children on save", async () => {
      const {Project} = buildNestedTestClasses()
      const fetchStub = stubFetch({model: {id: 42, name: "Launch"}})

      try {
        const project = new Project({name: "Launch"})
        project.getRelationshipByName("tasks").build({name: "Design"})
        project.getRelationshipByName("tasks").build({name: "Implement"})

        await expectNestedAttributesAfterSave(project, fetchStub, {
          tasks: [
            {attributes: {name: "Design"}},
            {attributes: {name: "Implement"}}
          ]
        })
      } finally {
        resetFrontendModelTransport()
        fetchStub.restore()
      }
    })

    it("emits _destroy entries for children marked for destruction and skips unchanged preloaded children", async () => {
      const {Project, Task} = buildNestedTestClasses()
      const fetchStub = stubFetch({model: {id: 5, name: "Launch"}})

      try {
        const project = /** @type {any} */ (Project).instantiateFromResponse({model: {id: 5, name: "Launch"}})

        const existingTask = /** @type {any} */ (Task).instantiateFromResponse({model: {id: 11, name: "Design", projectId: 5}})
        const doomedTask = /** @type {any} */ (Task).instantiateFromResponse({model: {id: 12, name: "Deprecated", projectId: 5}})

        project.getRelationshipByName("tasks").setLoaded([existingTask, doomedTask])

        doomedTask.markForDestruction()
        project.setName("Launch v2")

        await expectNestedAttributesAfterSave(project, fetchStub, {
          tasks: [{id: 12, _destroy: true}]
        })
      } finally {
        resetFrontendModelTransport()
        fetchStub.restore()
      }
    })

    it("recurses into grandchildren with nested attributes on the child resource", async () => {
      const {Project} = buildNestedTestClasses()
      const fetchStub = stubFetch({model: {id: 5, name: "Launch"}})

      try {
        const project = new Project({name: "Launch"})
        const task = project.getRelationshipByName("tasks").build({name: "Design"})
        task.getRelationshipByName("comments").build({body: "first!"})

        await expectNestedAttributesAfterSave(project, fetchStub, {
          tasks: [
            {
              attributes: {name: "Design"},
              nestedAttributes: {
                comments: [{attributes: {body: "first!"}}]
              }
            }
          ]
        })
      } finally {
        resetFrontendModelTransport()
        fetchStub.restore()
      }
    })

    it("emits submitted Rails-style belongs-to nested attributes", async () => {
      const {Task} = buildNestedTestClasses()
      const fetchStub = stubFetch({model: {id: 8, name: "Design", projectId: 6}})

      try {
        const task = new Task({
          name: "Design",
          projectAttributes: {name: "Launch"}
        })

        await task.save()

        expect(fetchStub.calls.length).toEqual(1)
        expect(fetchStub.calls[0].body.nestedAttributes).toEqual({
          project: [{attributes: {name: "Launch"}}]
        })
      } finally {
        resetFrontendModelTransport()
        fetchStub.restore()
      }
    })

    it("emits nested attachment payloads from submitted Rails-style child attributes", async () => {
      const {Project} = buildNestedTestClasses()
      const fetchStub = stubFetch({model: {id: 7, name: "Launch"}})

      try {
        const project = new Project({
          name: "Launch",
          tasksAttributes: [
            {
              descriptionFile: {
                contentBase64: "YXR0YWNobWVudA==",
                filename: "nested.txt"
              },
              name: "Design"
            }
          ]
        })

        await project.save()

        expect(fetchStub.calls.length).toEqual(1)
        expect(fetchStub.calls[0].body.nestedAttributes).toEqual({
          tasks: [
            {
              attachments: {
                descriptionFile: {
                  contentBase64: "YXR0YWNobWVudA==",
                  contentType: null,
                  filename: "nested.txt"
                }
              },
              attributes: {name: "Design"}
            }
          ]
        })
      } finally {
        resetFrontendModelTransport()
        fetchStub.restore()
      }
    })

    it("omits nestedAttributes from payload when no children are dirty", async () => {
      const {Project} = buildNestedTestClasses()
      const fetchStub = stubFetch({model: {id: 5, name: "Launch"}})

      try {
        const project = new Project({name: "Launch"})

        await project.save()

        expect(fetchStub.calls.length).toEqual(1)
        expect(fetchStub.calls[0].body.nestedAttributes).toEqual(undefined)
      } finally {
        resetFrontendModelTransport()
        fetchStub.restore()
      }
    })
  })
})
