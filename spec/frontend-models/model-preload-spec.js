import FrontendModelBase, {AttributeNotSelectedError} from "../../src/frontend-models/base.js"
import FrontendModelPreloader from "../../src/frontend-models/preloader.js"

/**
 * @typedef {object} FetchCall
 * @property {Record<string, any>} body - Normalized request payload.
 * @property {string} url - Request URL.
 */

/** @returns {{Comment: typeof FrontendModelBase, Project: typeof FrontendModelBase, Task: typeof FrontendModelBase}} - Test model classes. */
function buildModelClasses() {
  /** Frontend model comment test class. */
  class Comment extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "body"], commands: ["index"], primaryKey: "id"}
    }
  }

  /** Frontend model project test class. */
  class Project extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "name"], commands: ["index"], primaryKey: "id"}
    }

    /** @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes. */
    static relationshipModelClasses() {
      return {tasks: Task}
    }

    /** @returns {Record<string, {type: "hasMany"}>} - Relationship definitions. */
    static relationshipDefinitions() {
      return {tasks: {type: "hasMany"}}
    }
  }

  /** Frontend model task test class. */
  class Task extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "name"], commands: ["index"], primaryKey: "id"}
    }

    /** @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes. */
    static relationshipModelClasses() {
      return {comments: Comment, project: Project}
    }

    /** @returns {Record<string, {type: "hasMany" | "belongsTo"}>} - Relationship definitions. */
    static relationshipDefinitions() {
      return {comments: {type: "hasMany"}, project: {type: "belongsTo"}}
    }
  }

  return {Comment, Project, Task}
}

/**
 * @param {Record<string, any> | ((callIndex: number) => Record<string, any>)} responder - Body, or per-call body factory.
 * @returns {{calls: FetchCall[], restore: () => void}} - Recorded calls and restore callback.
 */
function stubFetch(responder) {
  const originalFetch = globalThis.fetch
  /** @type {FetchCall[]} */
  const calls = []

  globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
    const bodyString = typeof options?.body === "string" ? options.body : "{}"
    const parsedBody = JSON.parse(bodyString)
    const batchRequests = Array.isArray(parsedBody.requests) ? parsedBody.requests : null
    const normalizedBody = batchRequests && batchRequests.length === 1 && typeof batchRequests[0] === "object"
      ? batchRequests[0].payload
      : parsedBody
    const responseBody = typeof responder === "function" ? responder(calls.length) : responder
    const responsePayload = batchRequests
      ? {responses: batchRequests.map((req) => ({requestId: req.requestId, response: responseBody}))}
      : responseBody

    calls.push({body: normalizedBody, url: `${url}`})

    return /** @type {any} */ ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responsePayload),
      json: async () => responsePayload
    })
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
  FrontendModelBase.configureTransport({shared: undefined, url: undefined, websocketClient: undefined})
}

describe("Frontend models - model preload", () => {
  it("preloads a relationship onto an already-loaded record", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "5", body: "hi"}]}}]
    })

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload(Task.preload("comments"))

      const comments = task.getRelationshipByName("comments").loaded()

      expect(comments.length).toEqual(1)
      expect(comments[0].readAttribute("body")).toEqual("hi")
      expect(fetchStub.calls.length).toEqual(1)
      expect(fetchStub.calls[0].body.preload).toEqual({comments: true})
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("accepts a raw preload spec instead of a query", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "5", body: "raw"}]}}]
    })

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload("comments")

      expect(task.getRelationshipByName("comments").loaded()[0].readAttribute("body")).toEqual("raw")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("preloads across an array of records via Preloader.preload in one request", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [
        {id: "1", name: "T1", __preloadedRelationships: {project: {id: "10", name: "P"}}},
        {id: "2", name: "T2", __preloadedRelationships: {project: {id: "10", name: "P"}}}
      ]
    })

    try {
      const task1 = Task.instantiateFromResponse({id: "1", name: "T1"})
      const task2 = Task.instantiateFromResponse({id: "2", name: "T2"})

      await FrontendModelPreloader.preload([task1, task2], Task.preload("project"))

      expect(task1.getRelationshipByName("project").loaded().readAttribute("id")).toEqual("10")
      expect(task2.getRelationshipByName("project").loaded().readAttribute("id")).toEqual("10")
      expect(fetchStub.calls.length).toEqual(1)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("limits loaded columns with select and throws for non-selected attributes", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{body: "only-body"}]}}]
    })

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload(Task.preload("comments").select({Comment: ["body"]}))

      const comment = task.getRelationshipByName("comments").loaded()[0]

      expect(comment.readAttribute("body")).toEqual("only-body")
      expect(fetchStub.calls[0].body.select).toEqual({Comment: ["body"]})

      let thrownError = null

      try {
        comment.readAttribute("id")
      } catch (error) {
        thrownError = error
      }

      expect(thrownError instanceof AttributeNotSelectedError).toEqual(true)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("transports selectsExtra in the request payload", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "5", body: "hi"}]}}]
    })

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload(Task.preload("comments").selectsExtra({Comment: ["secret"]}))

      expect(fetchStub.calls[0].body.selectsExtra).toEqual({Comment: ["secret"]})
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("skips re-loading an already-preloaded relationship unless forced", async () => {
    const {Task} = buildModelClasses()
    let bodyVersion = "first"
    const fetchStub = stubFetch(() => ({
      models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "5", body: bodyVersion}]}}]
    }))

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload(Task.preload("comments"))

      expect(task.getRelationshipByName("comments").loaded()[0].readAttribute("body")).toEqual("first")
      expect(fetchStub.calls.length).toEqual(1)

      bodyVersion = "second"

      // No select + already preloaded → skipped, no new request.
      await task.preload(Task.preload("comments"))

      expect(fetchStub.calls.length).toEqual(1)
      expect(task.getRelationshipByName("comments").loaded()[0].readAttribute("body")).toEqual("first")

      // force re-fetches and refreshes the cached value.
      await task.preload(Task.preload("comments"), {force: true})

      expect(fetchStub.calls.length).toEqual(2)
      expect(task.getRelationshipByName("comments").loaded()[0].readAttribute("body")).toEqual("second")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("re-loads when a wider column set is requested than was previously preloaded", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch((callIndex) => ({
      models: [{
        id: "1",
        name: "T",
        __preloadedRelationships: {
          comments: [callIndex === 0 ? {body: "b"} : {id: "5", body: "b"}]
        }
      }]
    }))

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload(Task.preload("comments").select({Comment: ["body"]}))
      expect(fetchStub.calls.length).toEqual(1)

      // Requesting "id" too — not present on the loaded comment → re-fetch.
      await task.preload(Task.preload("comments").select({Comment: ["body", "id"]}))

      expect(fetchStub.calls.length).toEqual(2)
      expect(task.getRelationshipByName("comments").loaded()[0].readAttribute("id")).toEqual("5")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("reloads to populate a nested relationship even when the top-level relationship is already cached", async () => {
    const {Project} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [{
        id: "1",
        __preloadedRelationships: {
          tasks: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "9", body: "nested"}]}}]
        }
      }]
    })

    try {
      // `tasks` is already preloaded, but its `comments` are not.
      const project = Project.instantiateFromResponse({
        id: "1",
        __preloadedRelationships: {tasks: [{id: "1", name: "T"}]}
      })

      await project.preload(Project.preload({tasks: "comments"}))

      const tasks = project.getRelationshipByName("tasks").loaded()
      const comments = tasks[0].getRelationshipByName("comments").loaded()

      expect(fetchStub.calls.length).toEqual(1)
      expect(comments.length).toEqual(1)
      expect(comments[0].readAttribute("body")).toEqual("nested")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("always reloads for selectsExtra since defaults cannot be proven present", async () => {
    const {Task} = buildModelClasses()
    const fetchStub = stubFetch({
      models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "5", body: "hi"}]}}]
    })

    try {
      const task = Task.instantiateFromResponse({id: "1", name: "T"})

      await task.preload(Task.preload("comments").selectsExtra({Comment: ["body"]}))
      expect(fetchStub.calls.length).toEqual(1)

      // Even though comments are already preloaded with `body`, selectsExtra can't
      // be proven complete from the cache, so it reloads.
      await task.preload(Task.preload("comments").selectsExtra({Comment: ["body"]}))
      expect(fetchStub.calls.length).toEqual(2)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("keeps preload selects independent across cloned queries", () => {
    const {Task} = buildModelClasses()
    const base = Task.preload("comments").select({Comment: ["body"]}).selectsExtra({Comment: ["secret"]})
    const branch = base.clone().select({Comment: ["id"]}).selectsExtra({Comment: ["other"]})

    expect(base._select.Comment).toEqual(["body"])
    expect(base._selectsExtra.Comment).toEqual(["secret"])
    expect(branch._select.Comment).toEqual(["body", "id"])
    expect(branch._selectsExtra.Comment).toEqual(["secret", "other"])
  })
})
