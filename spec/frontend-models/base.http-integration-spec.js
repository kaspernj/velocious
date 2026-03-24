// @ts-check

import {waitFor} from "awaitery"
import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import Dummy from "../dummy/index.js"
import Project from "../dummy/src/models/project.js"
import TaskRecord from "../dummy/src/models/task.js"

/** Frontend model used for Node HTTP integration tests against dummy backend routes. */
class HttpFrontendModel extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], abilities: {find: string, index: string}, commands: {find: string, index: string}, path: string, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "email", "createdAt", "metadata", "nickName", "tags"],
      commands: {
        find: "frontend-find",
        index: "frontend-index"
      },
      modelName: "BrowserFrontendModel",
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }

  /** @returns {unknown} */
  id() { return this.readAttribute("id") }

  /** @returns {unknown} */
  email() { return this.readAttribute("email") }

  /** @returns {unknown} */
  createdAt() { return this.readAttribute("createdAt") }
}

/** Shared frontend model task class for websocket transport integration tests. */
class Task extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], commands: {find: string, index: string}, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      attributes: ["id", "name"],
      commands: {
        find: "find",
        index: "index"
      },
      primaryKey: "id"
    }
  }

  /** @returns {unknown} */
  id() { return this.readAttribute("id") }

  /** @returns {unknown} */
  name() { return this.readAttribute("name") }
}

/** Frontend model comment class for preload integration tests. */
class HttpPreloadComment extends FrontendModelBase {
  /**
   * @returns {{abilities: {index: string}, attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        index: "read"
      },
      attributes: ["id", "body"],
      commands: {
        index: "frontend-index"
      },
      modelName: "BrowserFrontendModel",
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }
}

/** Frontend model task class for preload integration tests. */
class HttpPreloadTask extends FrontendModelBase {
  /**
   * @returns {{abilities: {index: string}, attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        index: "read"
      },
      attributes: ["id", "name"],
      commands: {
        index: "frontend-index"
      },
      modelName: "BrowserFrontendModel",
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>}
   */
  static relationshipModelClasses() {
    return {
      comments: HttpPreloadComment
    }
  }

  /**
   * @returns {Record<string, {type: "hasMany"}>}
   */
  static relationshipDefinitions() {
    return {
      comments: {type: "hasMany"}
    }
  }

  /** @returns {unknown} */
  primaryInteraction() { return this.getRelationshipByName("primaryInteraction").loaded() }
}

/** Frontend model project class for preload integration tests. */
class HttpPreloadProject extends FrontendModelBase {
  /**
   * @returns {{abilities: {index: string}, attributes: string[], commands: {index: string}, path: string, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        index: "read"
      },
      attributes: ["id", "email"],
      commands: {
        index: "frontend-index"
      },
      modelName: "BrowserFrontendModel",
      path: "/frontend-model-system-tests",
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>}
   */
  static relationshipModelClasses() {
    return {
      tasks: HttpPreloadTask
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

/** @returns {void} */
function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
    credentials: undefined,
    request: undefined,
    shared: undefined,
    url: undefined,
    websocketClient: undefined
  })
}

/** @returns {void} */
function configureNodeTransport() {
  FrontendModelBase.configureTransport({
    url: "http://127.0.0.1:3006"
  })
}

/**
 * @param {WebsocketClient} websocketClient - Websocket client.
 * @returns {void}
 */
function configureWebsocketSharedTransport(websocketClient) {
  FrontendModelBase.configureTransport({
    shared: true,
    websocketClient
  })
}

describe("Frontend models - base http integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("loads frontend models through real websocket batch requests", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await Project.create({name: "Websocket frontend-model project"})
      const task = await TaskRecord.create({name: "Websocket frontend-model task", projectId: project.id()})

      configureWebsocketSharedTransport(websocketClient)

      try {
        const [tasks, foundTask] = await Promise.all([
          Task.toArray(),
          Task.findBy({id: task.id()})
        ])

        expect(tasks.some((loadedTask) => loadedTask.id() === task.id())).toEqual(true)
        expect(foundTask?.id()).toEqual(task.id())
        expect(foundTask?.name()).toEqual("Websocket frontend-model task")
      } finally {
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("receives frontend-model lifecycle events through websocket subscriptions", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await Project.create({name: "Websocket subscription project"})
      /** @type {Array<{action: "create" | "destroy" | "update", id: string, model: Task | null, modelName: string}>} */
      const events = []

      configureWebsocketSharedTransport(websocketClient)

      const unsubscribe = await Task.subscribeToEvents((event) => {
        events.push(event)
      })

      try {
        const task = await TaskRecord.create({name: "Created websocket task", projectId: project.id()})

        await waitFor(() => {
          if (events.length < 1) {
            throw new Error(`Expected at least one websocket frontend-model event but got ${events.length}`)
          }
        })

        task.setName("Updated websocket task")
        await task.save()

        await waitFor(() => {
          if (events.length < 2) {
            throw new Error(`Expected at least two websocket frontend-model events but got ${events.length}`)
          }
        })

        await task.destroy()

        await waitFor(() => {
          if (events.length < 3) {
            throw new Error(`Expected at least three websocket frontend-model events but got ${events.length}`)
          }
        })

        expect(events[0].action).toEqual("create")
        expect(events[0].model?.name()).toEqual("Created websocket task")
        expect(events[1].action).toEqual("update")
        expect(events[1].model?.name()).toEqual("Updated websocket task")
        expect(events[2].action).toEqual("destroy")
        expect(events[2].id).toEqual(task.id())
        expect(events[2].model).toEqual(null)
      } finally {
        unsubscribe()
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("findBy loads through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({email: "john@example.com"})

        expect(model?.id()).toEqual("2")
        expect(model?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("count loads through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const usersCount = await HttpFrontendModel.count()

        expect(usersCount).toEqual(2)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("where(...).toArray() filters records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const models = await HttpFrontendModel.where({email: "john@example.com"}).toArray()

        expect(models.length).toEqual(1)
        expect(models[0].id()).toEqual("2")
        expect(models[0].email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("where(...).findBy(...) merges conditions through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel
          .where({email: "john@example.com"})
          .findBy({id: "2"})

        expect(model?.id()).toEqual("2")
        expect(model?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("sort(...).toArray() orders records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const models = await HttpFrontendModel
          .sort("-createdAt")
          .toArray()

        expect(models.map((model) => model.id())).toEqual(["2", "1"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("order(...).toArray() orders records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const models = await HttpFrontendModel
          .order("-createdAt")
          .toArray()

        expect(models.map((model) => model.id())).toEqual(["2", "1"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("first()/last() apply deterministic ordering over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const firstModel = await HttpFrontendModel.first()
        const lastModel = await HttpFrontendModel.last()

        expect(firstModel?.id()).toEqual("1")
        expect(lastModel?.id()).toEqual("2")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("last() reverses explicit sort order over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel
          .sort("-createdAt")
          .last()

        expect(model?.id()).toEqual("1")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("limit(...).offset(...).toArray() paginates records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const models = await HttpFrontendModel
          .order("createdAt")
          .offset(1)
          .limit(1)
          .toArray()

        expect(models.map((model) => model.id())).toEqual(["2"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("page(...).perPage(...).toArray() paginates records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const models = await HttpFrontendModel
          .order("createdAt")
          .page(2)
          .perPage(1)
          .toArray()

        expect(models.map((model) => model.id())).toEqual(["2"])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy matches numeric id conditions against string ids over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({id: 2})

        expect(model?.id()).toEqual("2")
        expect(model?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy normalizes Date conditions over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({createdAt: new Date("2026-02-18T08:00:00.000Z")})

        expect(model?.id()).toEqual("1")
        expect(model?.createdAt()).toEqual("2026-02-18T08:00:00.000Z")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy matches nested object conditions by value over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({metadata: {region: "eu"}})

        expect(model?.id()).toEqual("2")
        expect(model?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy matches exact array attribute values over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({tags: ["a", "b"]})

        expect(model?.id()).toEqual("2")
        expect(model?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy only matches explicit null values over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({nickName: null})

        expect(model?.id()).toEqual("2")
        expect(model?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy returns null when no backend record matches", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const model = await HttpFrontendModel.findBy({email: "missing@example.com"})

        expect(model).toEqual(null)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findByOrFail raises when no backend record matches", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await expect(async () => {
          await HttpFrontendModel.findByOrFail({email: "missing@example.com"})
        }).toThrow(/HttpFrontendModel not found for conditions/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy raises when conditions include undefined", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await expect(async () => {
          await HttpFrontendModel.findBy({email: undefined})
        }).toThrow(/findBy does not support undefined condition values/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy raises when conditions include non-plain objects", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await expect(async () => {
          await HttpFrontendModel.findBy({email: /john/i})
        }).toThrow(/findBy does not support non-plain object condition values/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy raises when conditions is not a plain object", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await expect(async () => {
          await HttpFrontendModel.findBy(/** @type {any} */ (5))
        }).toThrow(/findBy expects conditions to be a plain object/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy raises when conditions include symbol keys", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const key = Symbol("id")

        await expect(async () => {
          await HttpFrontendModel.findBy({[key]: "2"})
        }).toThrow(/findBy does not support symbol condition keys/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findByOrFail raises when conditions include undefined", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await expect(async () => {
          await HttpFrontendModel.findByOrFail({email: undefined})
        }).toThrow(/findBy does not support undefined condition values/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("preloads nested relationships over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const projects = await HttpPreloadProject
          .preload({tasks: ["comments"]})
          .toArray()
        const tasks = projects[0].getRelationshipByName("tasks").loaded()
        const commentsForFirstTask = tasks[0].getRelationshipByName("comments").loaded()

        expect(tasks.length).toEqual(1)
        expect(commentsForFirstTask.length).toEqual(1)

        await expect(async () => {
          tasks[0].primaryInteraction()
        }).toThrow(/HttpPreloadTask#primaryInteraction hasn't been preloaded/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("throws AttributeNotSelectedError for non-selected frontend attributes", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const projects = await HttpPreloadProject
          .preload(["tasks"])
          .select({
            HttpPreloadProject: ["id"],
            HttpPreloadTask: ["updatedAt"]
          })
          .toArray()
        const tasks = projects[0].getRelationshipByName("tasks").loaded()

        expect(tasks[0].readAttribute("updatedAt")).toEqual("2026-02-20T10:00:00.000Z")
        expect(() => tasks[0].readAttribute("id")).toThrow(/HttpPreloadTask#id was not selected/)

        let thrownError = null

        try {
          tasks[0].readAttribute("id")
        } catch (error) {
          thrownError = error
        }

        expect(thrownError instanceof AttributeNotSelectedError).toEqual(true)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("supports select array shorthand as root-model attributes over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const baselineModel = await HttpFrontendModel.findBy({id: "2"})
        const models = await HttpFrontendModel
          .select(["id", "createdAt"])
          .where({id: "2"})
          .toArray()
        const firstModel = models[0]

        expect(baselineModel?.id()).toEqual("2")
        expect(models.length).toEqual(1)
        expect(firstModel.id()).toEqual("2")
        expect(firstModel.createdAt()).toEqual(baselineModel?.createdAt())
        expect(() => firstModel.email()).toThrow(/HttpFrontendModel#email was not selected/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })
})
