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

describe("Frontend models - base", () => {
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
      fetchStub.restore()
    }
  })
})
