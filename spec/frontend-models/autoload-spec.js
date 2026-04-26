import FrontendModelBase from "../../src/frontend-models/base.js"

/**
 * @typedef {{body: Record<string, any>, url: string}} FetchCall
 */

/**
 * @returns {{Comment: typeof FrontendModelBase, Project: typeof FrontendModelBase, Task: typeof FrontendModelBase}} - Test classes with relationships.
 */
function buildAutoloadTestModelClasses() {
  /** Frontend model comment test class. */
  class Comment extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: string[], primaryKey: string}}
     */
    static resourceConfig() {
      return {
        attributes: ["id", "body"],
        commands: ["index"],
        primaryKey: "id"
      }
    }
  }

  /** Frontend model task test class. */
  class Task extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: string[], primaryKey: string}}
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name"],
        commands: ["index"],
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
     * @returns {Record<string, {type: "hasMany" | "belongsTo", autoload?: boolean}>}
     */
    static relationshipDefinitions() {
      return {
        comments: {type: "hasMany"},
        project: {type: "belongsTo"}
      }
    }
  }

  /** Frontend model project test class. */
  class Project extends FrontendModelBase {
    /**
     * @returns {{attributes: string[], commands: string[], primaryKey: string}}
     */
    static resourceConfig() {
      return {
        attributes: ["id", "name"],
        commands: ["index"],
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
     * @returns {Record<string, {type: "hasMany", autoload?: boolean}>}
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
 * Fetch stub that selects response per request URL + body. Each entry is tried
 * in order; the first predicate that returns truthy wins. When no predicate
 * matches, throws so the test fails loudly instead of hanging on a bad stub.
 * @param {Array<{match: (body: Record<string, any>, url: string) => boolean, response: Record<string, any>}>} responders
 * @returns {{calls: FetchCall[], restore: () => void}} - Stub handle.
 */
function stubFetchWith(responders) {
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
    const stringUrl = `${url}`

    calls.push({body: normalizedBody, url: stringUrl})

    let matchedResponse = null

    for (const responder of responders) {
      if (responder.match(normalizedBody, stringUrl)) {
        matchedResponse = responder.response
        break
      }
    }

    if (!matchedResponse) {
      throw new Error(`No stub responder matched request: ${JSON.stringify(normalizedBody)}`)
    }

    const responsePayload = batchRequests
      ? {responses: batchRequests.map((req) => ({requestId: req.requestId, response: matchedResponse}))}
      : matchedResponse

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responsePayload),
      json: async () => responsePayload
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
    shared: undefined,
    url: undefined,
    websocketClient: undefined
  })
}

describe("Frontend models - autoload", () => {
  it("batch-loads a belongsTo relationship for every cohort sibling in one request", async () => {
    const {Task} = buildAutoloadTestModelClasses()

    const fetchStub = stubFetchWith([
      {
        // Initial list without preload.
        match: (body) => !body.preload && !body.where,
        response: {
          models: [
            {id: "1", name: "Task one"},
            {id: "2", name: "Task two"}
          ]
        }
      },
      {
        // Cohort preload request for projects.
        match: (body) => Boolean(body.preload?.project) && Array.isArray(body.where?.id) && body.where.id.length === 2,
        response: {
          models: [
            {id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}},
            {id: "2", name: "Task two", __preloadedRelationships: {project: {id: "102", name: "P2"}}}
          ]
        }
      }
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

    const fetchStub = stubFetchWith([
      {
        match: (body) => !body.preload && !body.where,
        response: {
          models: [
            {id: "1", name: "Task one"},
            {id: "2", name: "Task two"}
          ]
        }
      },
      {
        // Per-record preload via .find() — where is a single id, not an array.
        match: (body) => Boolean(body.preload?.project) && (typeof body.where?.id === "string" || typeof body.where?.id === "number"),
        response: {
          models: [{id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}}]
        }
      }
    ])

    try {
      const tasks = await Task.toArray()

      await tasks[0].relationshipOrLoad("project")

      // Sibling remains NOT preloaded — autoload disabled for this relationship.
      const secondRelationship = tasks[1].getRelationshipByName("project")

      expect(secondRelationship.getPreloaded()).toEqual(false)
    } finally {
      Task.relationshipDefinitions = originalDefinitions
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("falls back to per-record load when FrontendModelBase.setAutoload(false) is set globally", async () => {
    const {Task} = buildAutoloadTestModelClasses()
    const originalAutoload = FrontendModelBase.getAutoload()

    FrontendModelBase.setAutoload(false)

    const fetchStub = stubFetchWith([
      {
        match: (body) => !body.preload && !body.where,
        response: {
          models: [
            {id: "1", name: "Task one"},
            {id: "2", name: "Task two"}
          ]
        }
      },
      {
        match: (body) => Boolean(body.preload?.project) && (typeof body.where?.id === "string" || typeof body.where?.id === "number"),
        response: {
          models: [{id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}}]
        }
      }
    ])

    try {
      const tasks = await Task.toArray()

      await tasks[0].relationshipOrLoad("project")

      const secondRelationship = tasks[1].getRelationshipByName("project")

      expect(secondRelationship.getPreloaded()).toEqual(false)
    } finally {
      FrontendModelBase.setAutoload(originalAutoload)
      resetFrontendModelTransport()
      fetchStub.restore()
    }
  })

  it("falls back to per-record load when the caller record is missing from the cohort preload response", async () => {
    const {Task} = buildAutoloadTestModelClasses()

    const fetchStub = stubFetchWith([
      {
        match: (body) => !body.preload && !body.where,
        response: {
          models: [
            {id: "1", name: "Task one"},
            {id: "2", name: "Task two"}
          ]
        }
      },
      {
        // Cohort preload request — server only returns the other sibling, not the caller.
        match: (body) => Boolean(body.preload?.project) && Array.isArray(body.where?.id),
        response: {
          models: [
            {id: "2", name: "Task two", __preloadedRelationships: {project: {id: "102", name: "P2"}}}
          ]
        }
      },
      {
        // Per-record fallback — the record was deleted so the backend returns an empty list.
        match: (body) => Boolean(body.preload?.project) && (typeof body.where?.id === "string" || typeof body.where?.id === "number"),
        response: {models: []}
      }
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
      {
        match: (body) => !body.preload && !body.where,
        response: {
          models: [
            {id: "1", name: "Task one"},
            {id: "2", name: "Task two"}
          ]
        }
      },
      {
        match: (body) => Boolean(body.preload?.project) && Array.isArray(body.where?.id),
        response: {
          models: [
            {id: "1", name: "Task one", __preloadedRelationships: {project: {id: "101", name: "P1"}}}
            // Intentionally omit task 2 — cohort code must skip it because it's locally touched.
          ]
        }
      }
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
