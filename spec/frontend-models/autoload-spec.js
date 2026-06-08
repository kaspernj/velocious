import FrontendModelBase from "../../src/frontend-models/base.js"
import {buildPreloadTestModelClasses, resetFrontendModelTransport, stubFrontendModelFetchWith} from "../helpers/frontend-model-test-helpers.js"

const buildAutoloadTestModelClasses = buildPreloadTestModelClasses
const stubFetchWith = stubFrontendModelFetchWith

const TASK_SIBLING_MODELS = [
  {id: "1", name: "Task one"},
  {id: "2", name: "Task two"}
]

/**
 * @returns {{match: (body: Record<string, any>) => boolean, response: {models: Array<Record<string, any>>}}} - Initial sibling list responder.
 */
function taskSiblingsResponder() {
  return {
    match: (body) => !body.preload && !body.where,
    response: {models: TASK_SIBLING_MODELS}
  }
}

/**
 * @param {Array<Record<string, any>>} models - Response models.
 * @returns {{match: (body: Record<string, any>) => boolean, response: {models: Array<Record<string, any>>}}} - Cohort project preload responder.
 */
function projectCohortResponder(models) {
  return {
    match: (body) => Boolean(body.preload?.project) && Array.isArray(body.where?.id),
    response: {models}
  }
}

/**
 * @param {Array<Record<string, any>>} models - Response models.
 * @returns {{match: (body: Record<string, any>) => boolean, response: {models: Array<Record<string, any>>}}} - Per-record project preload responder.
 */
function projectPerRecordResponder(models) {
  return {
    match: (body) => Boolean(body.preload?.project) && (typeof body.where?.id === "string" || typeof body.where?.id === "number"),
    response: {models}
  }
}

/**
 * @param {typeof import("../../src/frontend-models/base.js").default} Task - Task frontend model class.
 * @returns {Promise<void>}
 */
async function expectPerRecordProjectPreload(Task) {
  const fetchStub = stubFetchWith([
    taskSiblingsResponder(),
    projectPerRecordResponder([{id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}}])
  ])

  try {
    const tasks = await Task.toArray()

    await tasks[0].relationshipOrLoad("project")

    const secondRelationship = tasks[1].getRelationshipByName("project")

    expect(secondRelationship.getPreloaded()).toEqual(false)
  } finally {
    resetFrontendModelTransport()
    fetchStub.restore()
  }
}

describe("Frontend models - autoload", {databaseCleaning: {transaction: true}}, () => {
  it("batch-loads a belongsTo relationship for every cohort sibling in one request", async () => {
    const {Task} = buildAutoloadTestModelClasses()

    const fetchStub = stubFetchWith([
      taskSiblingsResponder(),
      projectCohortResponder([
        {id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}},
        {id: "2", name: "Task two", __preloadedRelationships: {project: {id: "102", name: "P2"}}}
      ])
    ])

    try {
      const tasks = await Task.toArray()

      expect(tasks.length).toEqual(2)
      expect(fetchStub.calls.length).toEqual(1)

      // First lazy access triggers ONE cohort request for both tasks.
      const firstProject = await tasks[0].relationshipOrLoad("project")

      expect(firstProject.readAttribute("id")).toEqual("101")
      expect(fetchStub.calls.length).toEqual(2)

      // Sibling must now be preloaded — no additional request.
      const secondRelationship = tasks[1].getRelationshipByName("project")

      expect(secondRelationship.getPreloaded()).toEqual(true)

      const secondProject = await tasks[1].relationshipOrLoad("project")

      expect(secondProject.readAttribute("id")).toEqual("102")
      expect(fetchStub.calls.length).toEqual(2)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("batch-loads a hasMany relationship across cohort siblings via toArray()", async () => {
    const {Project} = buildAutoloadTestModelClasses()

    const fetchStub = stubFetchWith([
      {
        match: (body) => !body.preload && !body.where,
        response: {
          models: [
            {id: "1", name: "P1"},
            {id: "2", name: "P2"}
          ]
        }
      },
      {
        match: (body) => Boolean(body.preload?.tasks) && Array.isArray(body.where?.id),
        response: {
          models: [
            {id: "1", name: "P1", __preloadedRelationships: {tasks: [{id: "11", name: "T1"}]}},
            {id: "2", name: "P2", __preloadedRelationships: {tasks: [{id: "22", name: "T2"}]}}
          ]
        }
      }
    ])

    try {
      const projects = await Project.toArray()

      expect(projects.length).toEqual(2)
      expect(fetchStub.calls.length).toEqual(1)

      const firstTasks = await projects[0].getRelationshipByName("tasks").toArray()

      expect(firstTasks.length).toEqual(1)
      expect(firstTasks[0].readAttribute("id")).toEqual("11")
      expect(fetchStub.calls.length).toEqual(2)

      // Sibling is preloaded from the cohort batch — no additional request.
      const secondRelationship = projects[1].getRelationshipByName("tasks")

      expect(secondRelationship.getPreloaded()).toEqual(true)
      expect(secondRelationship.loaded().map((task) => task.readAttribute("id"))).toEqual(["22"])
      expect(fetchStub.calls.length).toEqual(2)
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("falls back to per-record load when autoload: false is set on the relationship", async () => {
    const {Task} = buildAutoloadTestModelClasses()

    // Patch definition to disable autoload for this test.
    const originalDefinitions = Task.relationshipDefinitions
    Task.relationshipDefinitions = () => ({
      comments: {type: "hasMany"},
      project: {type: "belongsTo", autoload: false}
    })

    try {
      await expectPerRecordProjectPreload(Task)
    } finally {
      Task.relationshipDefinitions = originalDefinitions
    }
  })

  it("falls back to per-record load when FrontendModelBase.setAutoload(false) is set globally", async () => {
    const {Task} = buildAutoloadTestModelClasses()
    const originalAutoload = FrontendModelBase.getAutoload()

    FrontendModelBase.setAutoload(false)

    try {
      await expectPerRecordProjectPreload(Task)
    } finally {
      FrontendModelBase.setAutoload(originalAutoload)
    }
  })

  it("falls back to per-record load when the caller record is missing from the cohort preload response", async () => {
    const {Task} = buildAutoloadTestModelClasses()

    const fetchStub = stubFetchWith([
      taskSiblingsResponder(),
      projectCohortResponder([{id: "2", name: "Task two", __preloadedRelationships: {project: {id: "102", name: "P2"}}}]),
      projectPerRecordResponder([])
    ])

    try {
      const tasks = await Task.toArray()
      let thrown = null

      try {
        await tasks[0].relationshipOrLoad("project")
      } catch (error) {
        thrown = error
      }

      // The caller must fall through to per-record load rather than throw
      // "hasn't been preloaded". The per-record path will throw a real
      // not-found error instead, which is the desired outcome.
      expect(thrown).toBeTruthy()
      expect(String(thrown?.message || "")).not.toContain("hasn't been preloaded")

      // The populated sibling still benefited from the batch attempt.
      const siblingRelationship = tasks[1].getRelationshipByName("project")

      expect(siblingRelationship.getPreloaded()).toEqual(true)
      expect(siblingRelationship.loaded().readAttribute("id")).toEqual("102")
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("preserves locally set singular relationship state on siblings during cohort preload", async () => {
    const {Project, Task} = buildAutoloadTestModelClasses()

    const fetchStub = stubFetchWith([
      taskSiblingsResponder(),
      projectCohortResponder([
        {id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}}
      ])
    ])

    try {
      const tasks = await Task.toArray()
      const overrideProject = new Project({id: "999", name: "Local override"})

      tasks[1].setRelationship("project", overrideProject)

      await tasks[0].relationshipOrLoad("project")

      const secondRelationship = tasks[1].getRelationshipByName("project")

      expect(secondRelationship.loaded()).toEqual(overrideProject)

      // Cohort preload request must have excluded the locally touched sibling.
      const cohortRequest = fetchStub.calls.find((call) => call.body.preload?.project)

      expect(cohortRequest?.body.where.id).toEqual(["1"])
    } finally {
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })
})
