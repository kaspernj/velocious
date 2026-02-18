// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"

/** @typedef {{body: Record<string, any>, url: string}} FetchCall */

/**
 * @returns {typeof FrontendModelBase} - Test frontend model class.
 */
function buildTestModelClass() {
  /** Test model implementation for frontend model base specs. */
  class User extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: {destroy: string, find: string, update: string}, path: string, primaryKey: string}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name", "email"],
        commands: {
          destroy: "destroy",
          find: "find",
          update: "update"
        },
        path: "/api/frontend-models/users",
        primaryKey: "id"
      }
    }

    /** @returns {any} */
    id() { return this.readAttribute("id") }

    /** @returns {any} */
    name() { return this.readAttribute("name") }

    /**
     * @param {any} newValue
     * @returns {any}
     */
    setName(newValue) { return this.setAttribute("name", newValue) }
  }

  return User
}

/**
 * @param {Record<string, any>} responseBody - Body to return from fetch.
 * @returns {{calls: FetchCall[], restore: () => void}} - Recorded calls and restore callback.
 */
function stubFetch(responseBody) {
  const originalFetch = globalThis.fetch
  /** @type {FetchCall[]} */
  const calls = []

  globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
    const bodyString = typeof options?.body === "string" ? options.body : "{}"

    calls.push({
      body: JSON.parse(bodyString),
      url: `${url}`
    })

    return {
      ok: true,
      status: 200,
      /** @returns {Promise<Record<string, any>>} */
      json: async () => responseBody
    }
  })

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    }
  }
}

/** @returns {void} */
function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
    baseUrl: undefined,
    baseUrlResolver: undefined,
    credentials: undefined,
    pathPrefix: undefined,
    pathPrefixResolver: undefined,
    request: undefined
  })
}

describe("Frontend models - base", () => {
  it("loads model collection with toArray", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{email: "john@example.com", id: 5, name: "John"}]})

    try {
      const users = await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "/api/frontend-models/users/index"
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

  it("finds a model and maps response attributes", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5, name: "John"}})

    try {
      const user = await User.find(5)

      expect(fetchStub.calls).toEqual([
        {
          body: {id: 5},
          url: "/api/frontend-models/users/find"
        }
      ])
      expect(user.id()).toEqual(5)
      expect(user.name()).toEqual("John")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("updates a model and refreshes local attributes", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({model: {email: "johnny@example.com", id: 5, name: "Johnny"}})
    const user = new User({email: "john@example.com", id: 5, name: "John"})

    try {
      await user.update({name: "John Changed"})

      expect(fetchStub.calls).toEqual([
        {
          body: {
            attributes: {email: "john@example.com", id: 5, name: "John Changed"},
            id: 5
          },
          url: "/api/frontend-models/users/update"
        }
      ])
      expect(user.name()).toEqual("Johnny")
      expect(user.readAttribute("email")).toEqual("johnny@example.com")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
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
          url: "/api/frontend-models/users/destroy"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("prefixes command URL with configured base URL", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    FrontendModelBase.configureTransport({
      baseUrl: "http://127.0.0.1:4501/"
    })

    try {
      await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "http://127.0.0.1:4501/api/frontend-models/users/index"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("adds configured path prefix before resource path", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    FrontendModelBase.configureTransport({
      baseUrl: "http://127.0.0.1:4501",
      pathPrefix: "/backend-api"
    })

    try {
      await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "http://127.0.0.1:4501/backend-api/api/frontend-models/users/index"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports dynamic base URL and path prefix resolvers", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    FrontendModelBase.configureTransport({
      baseUrlResolver: () => "http://localhost:4500/",
      pathPrefixResolver: () => "v1"
    })

    try {
      await User.toArray()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "http://localhost:4500/v1/api/frontend-models/users/index"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("supports custom request transport", async () => {
    const User = buildTestModelClass()
    /** @type {any[]} */
    const calls = []

    FrontendModelBase.configureTransport({
      request: async (args) => {
        calls.push(args)
        return {model: {id: 9, name: "Custom transport user"}}
      }
    })

    try {
      const user = await User.find(9)

      expect(calls).toEqual([
        {
          commandName: "find",
          commandType: "find",
          modelClass: User,
          payload: {id: 9},
          url: "/api/frontend-models/users/find"
        }
      ])
      expect(user.name()).toEqual("Custom transport user")
    } finally {
      resetFrontendModelTransport()
    }
  })
})
