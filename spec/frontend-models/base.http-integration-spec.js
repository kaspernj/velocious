// @ts-check

import {waitFor} from "awaitery"
import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import Dummy from "../dummy/index.js"
import CommentRecord from "../dummy/src/models/comment.js"
import ProjectRecord from "../dummy/src/models/project.js"
import TaskRecord from "../dummy/src/models/task.js"
import UserRecord from "../dummy/src/models/user.js"

/** Frontend model used for Node HTTP integration tests against dummy backend routes. */
class User extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], abilities: {find: string, index: string}, builtInCollectionCommands: string[], builtInMemberCommands: string[], collectionCommands: Record<string, string>, modelName: string, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "email", "createdAt"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      collectionCommands: {
        currentSessionCookie: "current-session-cookie",
        setSessionCookie: "set-session-cookie"
      },
      modelName: "User",
      primaryKey: "id"
    }
  }

  /** @returns {number} */
  id() { return this.readAttribute("id") }

  /** @returns {string} */
  email() { return this.readAttribute("email") }

  /** @returns {Date} */
  createdAt() { return this.readAttribute("createdAt") }

  /**
   * @param {Record<string, any>} [payload={}] - Command payload.
   * @returns {Promise<Record<string, any>>} - Command response.
   */
  static async currentSessionCookie(payload = {}) {
    return await this.executeCustomCommand({
      commandName: "current-session-cookie",
      commandType: "current-session-cookie",
      payload,
      resourcePath: this.resourcePath()
    })
  }

  /**
   * @param {Record<string, any>} [payload={}] - Command payload.
   * @returns {Promise<Record<string, any>>} - Command response.
   */
  static async setSessionCookie(payload = {}) {
    return await this.executeCustomCommand({
      commandName: "set-session-cookie",
      commandType: "set-session-cookie",
      payload,
      resourcePath: this.resourcePath()
    })
  }

  /**
   * @param {Record<string, any>} [payload={}] - Command payload.
   * @returns {Promise<{users: User[]}>} - Command response.
   */
  static async lookupByEmail(payload = {}) {
    return /** @type {Promise<{users: User[]}>} */ (this.executeCustomCommand({
      commandName: "lookup-by-email",
      commandType: "lookup-by-email",
      payload,
      resourcePath: this.resourcePath()
    }))
  }

  /**
   * @param {Record<string, any>} [payload={}] - Command payload.
   * @returns {Promise<{user: User | null}>} - Command response.
   */
  async refreshProfile(payload = {}) {
    const ModelClass = /** @type {typeof User} */ (this.constructor)

    return /** @type {Promise<{user: User | null}>} */ (ModelClass.executeCustomCommand({
      commandName: "refresh-profile",
      commandType: "refresh-profile",
      memberId: this.primaryKeyValue(),
      payload,
      resourcePath: ModelClass.resourcePath()
    }))
  }
}

FrontendModelBase.registerModel(User)

/** Frontend model that uses a stable backend model name different from its class name. */
class MinifiedUserTransportModel extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], abilities: {find: string, index: string}, builtInCollectionCommands: string[], builtInMemberCommands: string[], modelName: string, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "email", "createdAt"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      modelName: "User",
      primaryKey: "id"
    }
  }

  /** @returns {number} */
  id() { return this.readAttribute("id") }

  /** @returns {string} */
  email() { return this.readAttribute("email") }
}

/** Shared frontend model task class for websocket transport integration tests. */
class Task extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], builtInCollectionCommands: Record<string, string>, builtInMemberCommands: Record<string, string>, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      attributes: ["id", "name", "nameUppercase", "updatedAt"],
      builtInCollectionCommands: {
        index: "list"
      },
      builtInMemberCommands: {
        find: "find"
      },
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
   * @returns {Record<string, {type: "belongsTo" | "hasMany"}>}
   */
  static relationshipDefinitions() {
    return {
      comments: {type: "hasMany"},
      project: {type: "belongsTo"}
    }
  }

  /** @returns {number} */
  id() { return this.readAttribute("id") }

  /** @returns {string} */
  name() { return this.readAttribute("name") }

  /** @returns {unknown} */
  primaryInteraction() { return this.getRelationshipByName("primaryInteraction").loaded() }
}

FrontendModelBase.registerModel(Task)

/** Frontend model comment class for preload integration tests. */
class Comment extends FrontendModelBase {
  /**
   * @returns {{abilities: {find: string, index: string}, attributes: string[], builtInCollectionCommands: string[], builtInMemberCommands: string[], primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "body"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      primaryKey: "id"
    }
  }
}

FrontendModelBase.registerModel(Comment)

/** Frontend model project class for preload integration tests. */
class Project extends FrontendModelBase {
  /**
   * @returns {{abilities: {find: string, index: string}, attributes: string[], builtInCollectionCommands: Record<string, string>, builtInMemberCommands: Record<string, string>, primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      builtInCollectionCommands: {
        index: "index"
      },
      builtInMemberCommands: {
        find: "find"
      },
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>}
   */
  static relationshipModelClasses() {
    return {
      creatingUser: User,
      tasks: Task
    }
  }

  /**
   * @returns {Record<string, {type: "belongsTo" | "hasMany"}>}
   */
  static relationshipDefinitions() {
    return {
      creatingUser: {type: "belongsTo"},
      tasks: {type: "hasMany"}
    }
  }

  /** @returns {number} */
  id() { return this.readAttribute("id") }
}

FrontendModelBase.registerModel(Project)

/** @returns {void} */
function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
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

/**
 * @returns {Promise<{jane: UserRecord, john: UserRecord}>}
 */
async function seedHttpFrontendModels() {
  const jane = await UserRecord.create({
    createdAt: "2026-02-18T08:00:00.000Z",
    email: "jane@example.com",
    encryptedPassword: "password",
    reference: "user-1"
  })
  const john = await UserRecord.create({
    createdAt: "2026-02-19T08:00:00.000Z",
    email: "john@example.com",
    encryptedPassword: "password",
    reference: "user-2"
  })

  return {jane, john}
}

/**
 * @returns {Promise<{project: ProjectRecord, task: TaskRecord}>}
 */
async function seedHttpPreloadModels() {
  const project = await ProjectRecord.create({name: "HTTP preload project"})
  const task = await TaskRecord.create({
    name: "HTTP preload task",
    projectId: project.id(),
    updatedAt: "2026-02-20T10:00:00.000Z"
  })

  await CommentRecord.create({body: "HTTP preload comment", taskId: task.id()})

  return {project, task}
}

describe("Frontend models - base http integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("loads frontend models through real websocket batch requests", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Websocket frontend-model project"})
      const task = await TaskRecord.create({name: "Websocket frontend-model task", project})

      configureWebsocketSharedTransport(websocketClient)

      try {
        const [tasks, foundTask] = await Promise.all([
          Task.toArray(),
          Task.findBy({id: task.id()})
        ])

        expect(tasks.some((loadedTask) => loadedTask.name() === "Websocket frontend-model task")).toEqual(true)
        expect(foundTask?.id()).toEqual(task.id())
        expect(foundTask?.name()).toEqual("Websocket frontend-model task")
      } finally {
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("uses resourceConfig.modelName for shared HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await seedHttpFrontendModels()

        const user = await MinifiedUserTransportModel.findBy({email: "john@example.com"})

        expect(user?.email()).toEqual("john@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("hydrates custom collection and member command models over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {jane, john} = await seedHttpFrontendModels()
        const lookupResponse = await User.lookupByEmail({email: john.email()})
        const janeModel = await User.findBy({email: jane.email()})

        if (!janeModel) throw new Error("Expected Jane frontend model")

        const refreshResponse = await janeModel.refreshProfile()

        expect(lookupResponse.users).toHaveLength(1)
        expect(lookupResponse.users[0] instanceof User).toEqual(true)
        expect(lookupResponse.users[0].email()).toEqual(john.email())
        expect(refreshResponse.user instanceof User).toEqual(true)
        expect(refreshResponse.user?.email()).toEqual(jane.email())
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("receives frontend-model lifecycle events through websocket subscriptions", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()
      const project = await ProjectRecord.create({name: "Websocket subscription project"})
      /** @type {Array<{action: "create" | "destroy" | "update", id: string, model: Task | null, modelName: string}>} */
      const events = []

      configureWebsocketSharedTransport(websocketClient)

      const unsubscribe = await Task.subscribeToEvents((event) => {
        events.push(event)
      })

      try {
        const task = await TaskRecord.create({name: "Created websocket task", project})

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

  it("hydrates custom collection and member command models over shared websocket requests", async () => {
    await Dummy.run(async () => {
      const websocketClient = new WebsocketClient()

      configureWebsocketSharedTransport(websocketClient)

      try {
        const {jane, john} = await seedHttpFrontendModels()
        const lookupResponse = await User.lookupByEmail({email: john.email()})
        const janeModel = await User.findBy({email: jane.email()})

        if (!janeModel) throw new Error("Expected Jane frontend model")

        const refreshResponse = await janeModel.refreshProfile()

        expect(lookupResponse.users).toHaveLength(1)
        expect(lookupResponse.users[0] instanceof User).toEqual(true)
        expect(lookupResponse.users[0].email()).toEqual(john.email())
        expect(refreshResponse.user instanceof User).toEqual(true)
        expect(refreshResponse.user?.email()).toEqual(jane.email())
      } finally {
        resetFrontendModelTransport()
        await websocketClient.close()
      }
    })
  })

  it("findBy loads through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {john} = await seedHttpFrontendModels()

        const model = await User.findBy({email: "john@example.com"})

        expect(model?.id()).toEqual(john.id())
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
        await seedHttpFrontendModels()

        const usersCount = await User.count()

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
        const {john} = await seedHttpFrontendModels()

        const models = await User.where({email: "john@example.com"}).toArray()

        expect(models.length).toEqual(1)
        expect(models[0].id()).toEqual(john.id())
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
        const {john} = await seedHttpFrontendModels()

        const model = await User
          .where({email: "john@example.com"})
          .findBy({id: john.id()})

        expect(model?.id()).toEqual(john.id())
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
        const {jane, john} = await seedHttpFrontendModels()

        const models = await User
          .sort("-createdAt")
          .toArray()

        expect(models.map((model) => model.id())).toEqual([john.id(), jane.id()])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("order(...).toArray() orders records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {jane, john} = await seedHttpFrontendModels()

        const models = await User
          .order("-createdAt")
          .toArray()

        expect(models.map((model) => model.id())).toEqual([john.id(), jane.id()])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("first()/last() apply deterministic ordering over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {jane, john} = await seedHttpFrontendModels()

        const firstModel = await User.first()
        const lastModel = await User.last()

        expect(firstModel?.id()).toEqual(jane.id())
        expect(lastModel?.id()).toEqual(john.id())
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("last() reverses explicit sort order over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {jane} = await seedHttpFrontendModels()

        const model = await User
          .sort("-createdAt")
          .last()

        expect(model?.id()).toEqual(jane.id())
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("limit(...).offset(...).toArray() paginates records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {john} = await seedHttpFrontendModels()

        const models = await User
          .order("createdAt")
          .offset(1)
          .limit(1)
          .toArray()

        expect(models.map((model) => model.id())).toEqual([john.id()])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("page(...).perPage(...).toArray() paginates records through real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {john} = await seedHttpFrontendModels()

        const models = await User
          .order("createdAt")
          .page(2)
          .perPage(1)
          .toArray()

        expect(models.map((model) => model.id())).toEqual([john.id()])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy matches numeric id conditions against string ids over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {john} = await seedHttpFrontendModels()

        const model = await User.findBy({id: john.id()})

        expect(model?.id()).toEqual(john.id())
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
        const {jane} = await seedHttpFrontendModels()

        const model = await User.findBy({createdAt: new Date("2026-02-18T08:00:00.000Z")})

        expect(model?.id()).toEqual(jane.id())
        expect(model?.createdAt()?.toISOString()).toEqual("2026-02-18T08:00:00.000Z")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("findBy returns null when no backend record matches", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await seedHttpFrontendModels()

        const model = await User.findBy({email: "missing@example.com"})

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
        await seedHttpFrontendModels()

        await expect(async () => {
          await User.findByOrFail({email: "missing@example.com"})
        }).toThrow(/User not found for conditions/)
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
          await User.findBy({email: undefined})
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
          await User.findBy({email: /john/i})
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
          await User.findBy(/** @type {any} */ (5))
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
          await User.findBy({[key]: "2"})
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
          await User.findByOrFail({email: undefined})
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
        const {project} = await seedHttpPreloadModels()
        const loadedProject = await Project
          .preload({tasks: ["comments"]})
          .findBy({id: project.id()})
        const tasks = loadedProject?.getRelationshipByName("tasks").loaded() || []
        const commentsForFirstTask = tasks[0].getRelationshipByName("comments").loaded()

        expect(tasks.length).toEqual(1)
        expect(commentsForFirstTask.length).toEqual(1)

        await expect(async () => {
          tasks[0].primaryInteraction()
        }).toThrow(/Task#primaryInteraction hasn't been preloaded/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("reuses preloaded and explicit relationship loading over real Node HTTP requests", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {task} = await seedHttpPreloadModels()
        const loadedTask = await Task
          .preload(["project"])
          .findBy({id: task.id()})
        const loadedProject = await loadedTask?.relationshipOrLoad("project")
        const loadedTasks = await loadedProject?.getRelationshipByName("tasks").toArray()
        const cachedTasks = await loadedProject?.getRelationshipByName("tasks").toArray()
        const reloadedTasks = await loadedProject?.getRelationshipByName("tasks").load()

        expect(loadedProject?.id()).toEqual(task.projectId())
        expect(loadedTasks?.map((loadedModel) => loadedModel.id())).toEqual([task.id()])
        expect(cachedTasks?.map((loadedModel) => loadedModel.id())).toEqual([task.id()])
        expect(reloadedTasks?.map((loadedModel) => loadedModel.id())).toEqual([task.id()])
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("preloads belongsTo relationships via shared transport with find()", async () => {
    await Dummy.run(async () => {
      FrontendModelBase.configureTransport({
        shared: true,
        url: "http://127.0.0.1:3006"
      })

      try {
        const {project, task} = await seedHttpPreloadModels()
        const loadedTask = await Task.preload({project: true}).find(task.id())

        expect(loadedTask.name()).toEqual("HTTP preload task")

        const loadedProject = loadedTask.getRelationshipByName("project").loaded()

        expect(loadedProject).toBeDefined()
        expect(loadedProject.id()).toEqual(project.id())
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("preloads belongsTo relationships with custom className via shared transport", async () => {
    await Dummy.run(async () => {
      FrontendModelBase.configureTransport({
        shared: true,
        url: "http://127.0.0.1:3006"
      })

      try {
        const user = await UserRecord.create({email: "custom-class-user@example.com", encryptedPassword: "password", reference: "CustomRef-HTTP"})
        const project = await ProjectRecord.create({creatingUserReference: "CustomRef-HTTP"})
        const loadedProject = await Project.preload({creatingUser: true}).findBy({id: project.id()})

        expect(loadedProject).toBeDefined()

        const creatingUser = loadedProject.getRelationshipByName("creatingUser").loaded()

        expect(creatingUser).toBeDefined()
        expect(creatingUser.id()).toEqual(user.id())
        expect(creatingUser.email()).toEqual("custom-class-user@example.com")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("preloads with mixed array of strings and nested objects via shared transport", async () => {
    await Dummy.run(async () => {
      FrontendModelBase.configureTransport({
        shared: true,
        url: "http://127.0.0.1:3006"
      })

      try {
        const {project, task} = await seedHttpPreloadModels()
        const loadedTask = await Task.preload(["project", {comments: true}]).find(task.id())

        expect(loadedTask.name()).toEqual("HTTP preload task")

        const loadedProject = loadedTask.getRelationshipByName("project").loaded()

        expect(loadedProject).toBeDefined()
        expect(loadedProject.id()).toEqual(project.id())

        const comments = loadedTask.getRelationshipByName("comments").loaded()

        expect(comments.length).toEqual(1)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("serializes virtual resource attributes defined as methods on the resource class", async () => {
    await Dummy.run(async () => {
      FrontendModelBase.configureTransport({
        shared: true,
        url: "http://127.0.0.1:3006"
      })

      try {
        const project = await ProjectRecord.create({name: "Virtual attr project"})
        const task = await TaskRecord.create({
          name: "Virtual attr test",
          projectId: project.id(),
          updatedAt: "2026-02-20T10:00:00.000Z"
        })
        const loadedTask = await Task.find(task.id())

        expect(loadedTask.name()).toEqual("Virtual attr test")
        expect(loadedTask.readAttribute("nameUppercase")).toEqual("VIRTUAL ATTR TEST")
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("throws AttributeNotSelectedError for non-selected frontend attributes", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const {project} = await seedHttpPreloadModels()
        const loadedProject = await Project
          .preload(["tasks"])
          .select({
            Project: ["id"],
            Task: ["updatedAt"]
          })
          .findBy({id: project.id()})
        const tasks = loadedProject?.getRelationshipByName("tasks").loaded() || []

        expect(tasks[0].readAttribute("updatedAt").toISOString()).toEqual("2026-02-20T10:00:00.000Z")
        expect(() => tasks[0].readAttribute("id")).toThrow(/Task#id was not selected/)

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
        const {john} = await seedHttpFrontendModels()

        const baselineModel = await User.findBy({id: john.id()})
        const models = await User
          .select(["id", "createdAt"])
          .where({id: john.id()})
          .toArray()
        const firstModel = models[0]

        expect(baselineModel?.id()).toEqual(john.id())
        expect(models.length).toEqual(1)
        expect(firstModel.id()).toEqual(john.id())
        expect(firstModel.createdAt().toISOString()).toEqual(baselineModel?.createdAt()?.toISOString())
        expect(() => firstModel.email()).toThrow(/User#email was not selected/)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })
})
