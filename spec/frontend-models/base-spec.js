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
