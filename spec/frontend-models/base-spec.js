// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"

/** @typedef {{body: Record<string, any>, url: string}} FetchCall */

/**
 * @returns {typeof FrontendModelBase} - Test frontend model class.
 */
function buildTestModelClass() {
  /** Test model implementation for frontend model base specs. */
  class User extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: {create: string, destroy: string, find: string, index: string, update: string}, path: string, primaryKey: string}} - Resource configuration.
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name", "email"],
        commands: {
          create: "create",
          destroy: "destroy",
          find: "find",
          index: "index",
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
 * @returns {{Comment: typeof FrontendModelBase, Project: typeof FrontendModelBase, Task: typeof FrontendModelBase}} - Test classes with relationships.
 */
function buildPreloadTestModelClasses() {
  /** Frontend model comment test class. */
  class Comment extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
     */
    static resourceConfig() {
      return {
        attributes: ["id", "body"],
        commands: {index: "index"},
        path: "/api/frontend-models/comments",
        primaryKey: "id"
      }
    }
  }

  /** Frontend model task test class. */
  class Task extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name"],
        commands: {index: "index"},
        path: "/api/frontend-models/tasks",
        primaryKey: "id"
      }
    }

    /**
     * @returns {Record<string, typeof FrontendModelBase>}
     */
    static relationshipModelClasses() {
      return {
        comments: Comment,
        project: Project
      }
    }

    /**
     * @returns {Record<string, {type: "hasMany" | "belongsTo"}>}
     */
    static relationshipDefinitions() {
      return {
        comments: {type: "hasMany"},
        project: {type: "belongsTo"}
      }
    }

    /** @returns {import("../../src/frontend-models/base.js").default} */
    primaryInteraction() {
      return this.getRelationshipByName("primaryInteraction").loaded()
    }
  }

  /** Frontend model project test class. */
  class Project extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name"],
        commands: {index: "index"},
        path: "/api/frontend-models/projects",
        primaryKey: "id"
      }
    }

    /**
     * @returns {Record<string, typeof FrontendModelBase>}
     */
    static relationshipModelClasses() {
      return {
        tasks: Task
      }
    }

    /**
     * @returns {Record<string, {type: "hasMany"}>}
     */
    static relationshipDefinitions() {
      return {
        tasks: {type: "hasMany"}
      }
    }
  }

  return {Comment, Project, Task}
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
      /** @returns {Promise<string>} */
      text: async () => JSON.stringify(responseBody),
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
  it("uses the shared frontend-model API and batches requests when resource path is not configured", async () => {
    const originalFetch = globalThis.fetch
    /** @type {FetchCall[]} */
    const calls = []

    /** Shared API user model without explicit resource path. */
    class SharedApiUser extends FrontendModelBase {
      /**
       * @returns {{attributes: string[], commands: {index: string}, primaryKey: string}}
       */
      static resourceConfig() {
        return {
          attributes: ["id", "name"],
          commands: {
            index: "index"
          },
          primaryKey: "id"
        }
      }
    }

    globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
      const bodyString = typeof options?.body === "string" ? options.body : "{}"
      const body = JSON.parse(bodyString)

      calls.push({
        body,
        url: `${url}`
      })

      const responses = (body.requests || []).map((requestEntry) => ({
        requestId: requestEntry.requestId,
        response: {
          models: [{id: "1", name: "One"}],
          status: "success"
        }
      }))

      return {
        ok: true,
        status: 200,
        /** @returns {Promise<string>} */
        text: async () => JSON.stringify({responses, status: "success"}),
        /** @returns {Promise<Record<string, any>>} */
        json: async () => ({responses, status: "success"})
      }
    })

    try {
      const [firstResult, secondResult] = await Promise.all([
        SharedApiUser.toArray(),
        SharedApiUser.toArray()
      ])

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toEqual("/velocious/api")
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

  it("returns model count with count", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({
      models: [
        {email: "john@example.com", id: 5, name: "John"},
        {email: "jane@example.com", id: 6, name: "Jane"}
      ]
    })

    try {
      const usersCount = await User.count()

      expect(fetchStub.calls).toEqual([
        {
          body: {},
          url: "/api/frontend-models/users/index"
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
          url: "/api/frontend-models/users/index"
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
          url: "/api/frontend-models/users/index"
        }
      ])
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
          url: "/api/frontend-models/users/index"
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
          url: "/api/frontend-models/users/index"
        }
      ])
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
          url: "/api/frontend-models/users/index"
        }
      ])
      expect(user?.id()).toEqual(7)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends searches payload when using search(...).toArray()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: []})

    try {
      const oneDayAgo = new Date("2026-02-24T10:00:00.000Z")

      await User
        .search([], "createdAt", "gteq", oneDayAgo)
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
          url: "/api/frontend-models/users/index"
        }
      ])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("sends relationship-path searches payload when using search(...).count()", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({models: [{id: 1}, {id: 2}]})

    try {
      const oneDayAgo = new Date("2026-02-24T10:00:00.000Z")
      const usersCount = await User
        .search(["accountUsers", "account"], "createdAt", "gteq", oneDayAgo)
        .count()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            searches: [
              {
                column: "createdAt",
                operator: "gteq",
                path: ["accountUsers", "account"],
                value: {__velocious_type: "date", value: "2026-02-24T10:00:00.000Z"}
              }
            ]
          },
          url: "/api/frontend-models/users/index"
        }
      ])
      expect(usersCount).toEqual(2)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
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
          url: "/api/frontend-models/users/index"
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
          url: "/api/frontend-models/tasks/index"
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
          url: "/api/frontend-models/tasks/index"
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

  it("does not treat raw model status attributes as command errors for fetch transport", async () => {
    const User = buildTestModelClass()
    const fetchStub = stubFetch({id: 5, name: "Domain status model", status: "error"})

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
          url: "/api/frontend-models/users/find"
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
          url: "/api/frontend-models/users/index"
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
      resetFrontendModelTransport()
      fetchStub.restore()
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
          url: "/api/frontend-models/users/index"
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
    const fetchStub = stubFetch({model: {email: "john@example.com", id: 5}})

    try {
      const user = await User
        .select({
          User: ["email"]
        })
        .find(5)

      expect(user.id()).toEqual(5)
      await user.destroy()

      expect(fetchStub.calls).toEqual([
        {
          body: {
            id: 5,
            select: {
              User: ["id", "email"]
            }
          },
          url: "/api/frontend-models/users/find"
        },
        {
          body: {id: 5},
          url: "/api/frontend-models/users/destroy"
        }
      ])
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
          url: "/api/frontend-models/projects/index"
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
          url: "/api/frontend-models/projects/index"
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
    const {Project, Task} = buildPreloadTestModelClasses()
    const fetchStub = stubFetch({
      model: {
        id: "1",
        name: "One",
        __preloadedRelationships: {
          tasks: [
            {id: "11", name: "Task 1"}
          ]
        }
      }
    })
    const project = new Project({id: "1", name: "One"})
    const task = new Task({id: "11", name: "Task 1"})

    try {
      const loadedTasks = await project.loadRelationship("tasks")

      expect(fetchStub.calls).toEqual([
        {
          body: {
            id: "1",
            preload: {
              tasks: true
            }
          },
          url: "/api/frontend-models/projects/find"
        }
      ])
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
          url: "/api/frontend-models/users/create"
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
          url: "/api/frontend-models/users/index"
        },
        {
          body: {
            where: {
              email: "new@example.com"
            }
          },
          url: "/api/frontend-models/users/index"
        },
        {
          body: {
            attributes: {
              email: "new@example.com",
              name: "Local Name"
            }
          },
          url: "/api/frontend-models/users/create"
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
    const responseDateString = "2026-02-22T09:30:00.000Z"
    /** @type {any[]} */
    const calls = []

    FrontendModelBase.configureTransport({
      request: async (args) => {
        calls.push(args)
        return {
          model: {
            createdAt: {__velocious_type: "date", value: responseDateString},
            id: 9,
            maybeMissing: {__velocious_type: "undefined"},
            name: "Custom transport user"
          }
        }
      }
    })

    try {
      const user = await User.find(9)

      expect(calls.length).toEqual(1)
      expect(calls[0].commandName).toEqual("find")
      expect(calls[0].commandType).toEqual("find")
      expect(calls[0].modelClass).toEqual(User)
      expect(calls[0].payload.id).toEqual(9)
      expect(calls[0].url).toEqual("/api/frontend-models/users/find")
      expect(user.readAttribute("createdAt") instanceof Date).toEqual(true)
      expect(user.readAttribute("createdAt").toISOString()).toEqual(responseDateString)
      expect(user.readAttribute("maybeMissing")).toEqual(undefined)
      expect(user.name()).toEqual("Custom transport user")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("raises when custom request transport returns an error status payload", async () => {
    const User = buildTestModelClass()

    FrontendModelBase.configureTransport({
      request: async () => {
        return {
          errorMessage: "Custom transport unauthorized.",
          status: "error"
        }
      }
    })

    try {
      await expect(async () => {
        await User.find(9)
      }).toThrow(/Custom transport unauthorized./)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("does not treat raw model status attributes as command errors for custom transport", async () => {
    const User = buildTestModelClass()

    FrontendModelBase.configureTransport({
      request: async () => {
        return {
          id: 9,
          name: "Custom domain status model",
          status: "error"
        }
      }
    })

    try {
      const user = await User.find(9)

      expect(user.id()).toEqual(9)
      expect(user.name()).toEqual("Custom domain status model")
      expect(user.readAttribute("status")).toEqual("error")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("raises when custom request transport returns status error with envelope keys", async () => {
    const User = buildTestModelClass()

    FrontendModelBase.configureTransport({
      request: async () => {
        return {
          code: "forbidden",
          status: "error"
        }
      }
    })

    try {
      await expect(async () => {
        await User.find(9)
      }).toThrow(/Request failed for User#find/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("raises when custom request transport returns status error with message envelope", async () => {
    const User = buildTestModelClass()

    FrontendModelBase.configureTransport({
      request: async () => {
        return {
          message: "Forbidden by custom renderer.",
          status: "error"
        }
      }
    })

    try {
      await expect(async () => {
        await User.find(9)
      }).toThrow(/Request failed for User#find/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("serializes special values before calling custom request transport", async () => {
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
      await User.executeCommand("find", {
        hugeCounter: 9007199254740993n,
        id: 9,
        missing: undefined,
        negativeInfinity: Number.NEGATIVE_INFINITY,
        notANumber: Number.NaN,
        positiveInfinity: Number.POSITIVE_INFINITY
      })

      expect(calls.length).toEqual(1)
      expect(calls[0].commandName).toEqual("find")
      expect(calls[0].commandType).toEqual("find")
      expect(calls[0].modelClass).toEqual(User)
      expect(calls[0].payload.hugeCounter).toEqual({__velocious_type: "bigint", value: "9007199254740993"})
      expect(calls[0].payload.id).toEqual(9)
      expect(calls[0].payload.missing).toEqual({__velocious_type: "undefined"})
      expect(calls[0].payload.negativeInfinity).toEqual({__velocious_type: "number", value: "-Infinity"})
      expect(calls[0].payload.notANumber).toEqual({__velocious_type: "number", value: "NaN"})
      expect(calls[0].payload.positiveInfinity).toEqual({__velocious_type: "number", value: "Infinity"})
      expect(calls[0].url).toEqual("/api/frontend-models/users/find")
    } finally {
      resetFrontendModelTransport()
    }
  })
})
