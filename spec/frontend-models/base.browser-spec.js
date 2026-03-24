import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"
import CommentRecord from "../dummy/src/models/comment.js"
import ProjectRecord from "../dummy/src/models/project.js"
import TaskRecord from "../dummy/src/models/task.js"
import UserRecord from "../dummy/src/models/user.js"

/** Frontend model used for browser integration tests against dummy backend routes. */
class User extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], abilities: {find: string, index: string}, builtInCollectionCommands: string[], builtInMemberCommands: string[], primaryKey: string}} - Resource config.
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
      primaryKey: "id"
    }
  }

  /** @returns {number} */
  id() { return this.readAttribute("id") }

  /** @returns {string} */
  email() { return this.readAttribute("email") }

  /** @returns {Date} */
  createdAt() { return this.readAttribute("createdAt") }
}

/** Frontend model comment class for browser preload integration tests. */
class Comment extends FrontendModelBase {
  /**
   * @returns {{abilities: {find: string, index: string}, attributes: string[], builtInCollectionCommands: Record<string, string>, builtInMemberCommands: string[], primaryKey: string}}
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

/** Frontend model task class for browser preload integration tests. */
class Task extends FrontendModelBase {
  /**
   * @returns {{abilities: {find: string, index: string}, attributes: string[], builtInCollectionCommands: string[], builtInMemberCommands: string[], primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "name", "updatedAt"],
      builtInCollectionCommands: {
        index: "list"
      },
      builtInMemberCommands: ["find"],
      primaryKey: "id"
    }
  }

  /**
   * @returns {Record<string, typeof FrontendModelBase>}
   */
  static relationshipModelClasses() {
    return {
      comments: Comment
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

/** Frontend model project class for browser preload integration tests. */
class Project extends FrontendModelBase {
  /**
   * @returns {{abilities: {find: string, index: string}, attributes: string[], builtInCollectionCommands: string[], builtInMemberCommands: string[], primaryKey: string}}
   */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
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

/** @returns {void} */
function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({
    url: undefined,
    credentials: undefined,
    request: undefined
  })
}

/** @returns {Promise<void>} */
async function seedUsers() {
  await UserRecord.create({
    createdAt: "2026-02-18T08:00:00.000Z",
    email: "jane@example.com",
    encryptedPassword: "password",
    reference: "browser-user-1"
  })
  await UserRecord.create({
    createdAt: "2026-02-19T08:00:00.000Z",
    email: "john@example.com",
    encryptedPassword: "password",
    reference: "browser-user-2"
  })
}

/** @returns {Promise<{project: ProjectRecord, task: TaskRecord}>} */
async function seedBrowserPreloadModels() {
  const project = await ProjectRecord.create({name: "Browser preload project"})
  const task = await TaskRecord.create({
    name: "Browser preload task",
    projectId: project.id(),
    updatedAt: "2026-02-20T10:00:00.000Z"
  })

  await CommentRecord.create({body: "Browser preload comment", taskId: task.id()})

  return {project, task}
}

/** @returns {boolean} */
function runBrowserHttpIntegration() {
  return process.env.VELOCIOUS_BROWSER_TESTS === "true"
}

/** @returns {void} */
function configureBrowserTransport() {
  const configuredPort = Number(process.env.VELOCIOUS_BROWSER_BACKEND_PORT)
  const backendPort = Number.isFinite(configuredPort) ? configuredPort : 4501

  FrontendModelBase.configureTransport({
    url: `http://127.0.0.1:${backendPort}/frontend-models`
  })
}

describe("Frontend models - base browser integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("findBy loads through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const model = await User.findBy({email: "john@example.com"})

      expect(model?.id()).toEqual(2)
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("count loads through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const usersCount = await User.count()

      expect(usersCount).toEqual(2)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("where(...).toArray() filters records through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const models = await User.where({email: "john@example.com"}).toArray()

      expect(models.length).toEqual(1)
      expect(models[0].id()).toEqual(2)
      expect(models[0].email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("where(...).findBy(...) merges conditions through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const model = await User
        .where({email: "john@example.com"})
        .findBy({id: "2"})

      expect(model?.id()).toEqual(2)
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("sort(...).toArray() orders records through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const models = await User
        .sort("-createdAt")
        .toArray()

      expect(models.map((model) => model.id())).toEqual([2, 1])
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("order(...).toArray() orders records through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const models = await User
        .order("-createdAt")
        .toArray()

      expect(models.map((model) => model.id())).toEqual([2, 1])
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("first()/last() apply deterministic ordering over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const firstModel = await User.first()
      const lastModel = await User.last()

      expect(firstModel?.id()).toEqual(1)
      expect(lastModel?.id()).toEqual(2)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("last() reverses explicit sort order over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const model = await User
        .sort("-createdAt")
        .last()

      expect(model?.id()).toEqual(1)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("limit(...).offset(...).toArray() paginates records through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const models = await User
        .order("createdAt")
        .offset(1)
        .limit(1)
        .toArray()

      expect(models.map((model) => model.id())).toEqual([2])
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("page(...).perPage(...).toArray() paginates records through real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const models = await User
        .order("createdAt")
        .page(2)
        .perPage(1)
        .toArray()

      expect(models.map((model) => model.id())).toEqual([2])
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy matches numeric id conditions against string ids over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const model = await User.findBy({id: 2})

      expect(model?.id()).toEqual(2)
      expect(model?.email()).toEqual("john@example.com")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy normalizes Date conditions over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const model = await User.findBy({createdAt: new Date("2026-02-18T08:00:00.000Z")})

      expect(model?.id()).toEqual(1)
      expect(model?.createdAt()?.toISOString()).toEqual("2026-02-18T08:00:00.000Z")
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy returns null when no backend record matches", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const model = await User.findBy({email: "missing@example.com"})

      expect(model).toEqual(null)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findByOrFail raises when no backend record matches", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      await expect(async () => {
        await User.findByOrFail({email: "missing@example.com"})
      }).toThrow(/User not found for conditions/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions include undefined", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await User.findBy({email: undefined})
      }).toThrow(/findBy does not support undefined condition values/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions include non-plain objects", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await User.findBy({email: /john/i})
      }).toThrow(/findBy does not support non-plain object condition values/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions is not a plain object", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await User.findBy(/** @type {any} */ (5))
      }).toThrow(/findBy expects conditions to be a plain object/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findBy raises when conditions include symbol keys", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const key = Symbol("id")

      await expect(async () => {
        await User.findBy({[key]: "2"})
      }).toThrow(/findBy does not support symbol condition keys/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("findByOrFail raises when conditions include undefined", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await expect(async () => {
        await User.findByOrFail({email: undefined})
      }).toThrow(/findBy does not support undefined condition values/)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("preloads nested relationships over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const {project} = await seedBrowserPreloadModels()
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

  it("throws AttributeNotSelectedError for non-selected frontend attributes", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      const {project} = await seedBrowserPreloadModels()
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

  it("supports select array shorthand as root-model attributes over real browser HTTP requests", async () => {
    if (!runBrowserHttpIntegration()) {
      return
    }

    configureBrowserTransport()

    try {
      await seedUsers()

      const baselineModel = await User.findBy({id: "2"})
      const models = await User
        .select(["id", "createdAt"])
        .where({id: "2"})
        .toArray()
      const firstModel = models[0]

      expect(baselineModel?.id()).toEqual(2)
      expect(models.length).toEqual(1)
      expect(firstModel.id()).toEqual(2)
      expect(firstModel.createdAt().toISOString()).toEqual(baselineModel?.createdAt()?.toISOString())
      expect(() => firstModel.email()).toThrow(/User#email was not selected/)
    } finally {
      resetFrontendModelTransport()
    }
  })
})
