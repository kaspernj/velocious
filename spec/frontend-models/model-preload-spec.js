import {AttributeNotSelectedError} from "../../src/frontend-models/base.js"
import FrontendModelPreloader from "../../src/frontend-models/preloader.js"
import {buildPreloadTestModelClasses, resetFrontendModelTransport, stubFrontendModelFetch} from "../helpers/frontend-model-test-helpers.js"

const buildModelClasses = buildPreloadTestModelClasses
const stubFetch = stubFrontendModelFetch

/**
 * @param {string} commentBody - Preloaded comment body.
 * @returns {{models: Array<Record<string, any>>}} - Preloaded task response.
 */
function taskWithPreloadedComment(commentBody) {
  return {
    models: [{id: "1", name: "T", __preloadedRelationships: {comments: [{id: "5", body: commentBody}]}}]
  }
}

/**
 * @returns {any} - Test task with comments relationship.
 */
function buildPreloadCommentTask() {
  const {Task} = buildModelClasses()

  return Task.instantiateFromResponse({id: "1", name: "T"})
}

/**
 * @param {any} preloadSpec - Preload query or raw preload spec.
 * @param {(fetchStub: {calls: Array<{body: Record<string, any>, url: string}>}, task: any) => void | Promise<void>} expectLoaded - Assertion callback.
 * @returns {Promise<void>}
 */
async function expectPreloadedComment(preloadSpec, expectLoaded) {
  const fetchStub = stubFetch(taskWithPreloadedComment("hi"))

  try {
    const task = buildPreloadCommentTask()

    await task.preload(preloadSpec)

    await expectLoaded(fetchStub, task)
  } finally {
    resetFrontendModelTransport()
    fetchStub.restore()
  }
}

describe("Frontend models - model preload", () => {
  it("preloads a relationship onto an already-loaded record", async () => {
    const {Task} = buildModelClasses()

    await expectPreloadedComment(Task.preload("comments"), (fetchStub, task) => {
      const comments = task.getRelationshipByName("comments").loaded()

      expect(comments.length).toEqual(1)
      expect(comments[0].readAttribute("body")).toEqual("hi")
      expect(fetchStub.calls.length).toEqual(1)
      expect(fetchStub.calls[0].body.preload).toEqual({comments: true})
    })
  })

  it("accepts a raw preload spec instead of a query", async () => {
    const fetchStub = stubFetch(taskWithPreloadedComment("raw"))

    try {
      const task = buildPreloadCommentTask()

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

    await expectPreloadedComment(Task.preload("comments").selectsExtra({Comment: ["secret"]}), (fetchStub) => {
      expect(fetchStub.calls[0].body.selectsExtra).toEqual({Comment: ["secret"]})
    })
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

    await expectPreloadedComment(Task.preload("comments").selectsExtra({Comment: ["body"]}), async (fetchStub, task) => {
      expect(fetchStub.calls.length).toEqual(1)

      // Even though comments are already preloaded with `body`, selectsExtra can't
      // be proven complete from the cache, so it reloads.
      await task.preload(Task.preload("comments").selectsExtra({Comment: ["body"]}))
      expect(fetchStub.calls.length).toEqual(2)
    })
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
