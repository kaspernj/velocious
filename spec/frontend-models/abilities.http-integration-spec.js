// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import Project from "../dummy/src/models/project.js"
import TaskModel from "../dummy/src/models/task.js"

/** Frontend model used for per-record ability HTTP integration tests against dummy backend routes. */
class Task extends FrontendModelBase {
  /**
   * @returns {{attributes: string[], commands: string[]}} - Resource config.
   */
  static resourceConfig() {
    return {
      attributes: ["id", "identifier", "isDone", "name"],
      commands: ["destroy", "find", "index", "update"]
    }
  }

  /** @returns {unknown} */
  id() { return this.readAttribute("id") }

  /** @returns {unknown} */
  name() { return this.readAttribute("name") }
}

/**
 * @param {"destroy" | "read" | "update" | undefined} deniedAbilityAction - Ability action to deny.
 * @param {() => Promise<void>} callback - Callback.
 * @returns {Promise<void>}
 */
async function withDeniedTaskAbilityAction(deniedAbilityAction, callback) {
  const previousDeniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

  try {
    process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = deniedAbilityAction
    await callback()
  } finally {
    if (previousDeniedAction === undefined) {
      delete process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION
    } else {
      process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION = previousDeniedAction
    }
  }
}

/**
 * @param {string} userReference - Scoped user reference for the subquery condition.
 * @param {() => Promise<void>} callback - Callback.
 * @returns {Promise<void>}
 */
async function withSubqueryAbilityScope(userReference, callback) {
  const previous = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_SUBQUERY_SCOPE

  try {
    process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_SUBQUERY_SCOPE = userReference
    await callback()
  } finally {
    if (previous === undefined) {
      delete process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_SUBQUERY_SCOPE
    } else {
      process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_SUBQUERY_SCOPE = previous
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

/** @returns {void} */
function configureNodeTransport() {
  FrontendModelBase.configureTransport({
    url: "http://127.0.0.1:3006"
  })
}

/**
 * @param {object} args - Arguments.
 * @param {string} args.taskName - Task name.
 * @param {string} [args.creatingUserReference] - Optional project owner reference.
 * @returns {Promise<TaskModel>} - Created task model.
 */
async function createTaskWithProject({taskName, creatingUserReference}) {
  const project = await Project.create({
    creatingUserReference,
    name: `Project for ${taskName}`
  })

  return /** @type {TaskModel} */ (await TaskModel.create({
    name: taskName,
    projectId: project.id()
  }))
}

describe("Frontend models - per-record abilities http integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("hydrates record.can(action) for actions the ability allows in the flat-array form", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await createTaskWithProject({taskName: "Allowed abilities task"})

        const tasks = await Task.query().abilities(["update", "destroy"]).toArray()

        expect(tasks.length).toBe(1)
        expect(tasks[0].can("update")).toBe(true)
        expect(tasks[0].can("destroy")).toBe(true)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("returns can(action) === false for actions the current ability denies", async () => {
    await withDeniedTaskAbilityAction("update", async () => {
      await Dummy.run(async () => {
        configureNodeTransport()

        try {
          await createTaskWithProject({taskName: "Denied update abilities task"})

          const tasks = await Task.query().abilities(["update", "destroy"]).toArray()

          expect(tasks.length).toBe(1)
          expect(tasks[0].can("update")).toBe(false)
          expect(tasks[0].can("destroy")).toBe(true)
        } finally {
          resetFrontendModelTransport()
        }
      })
    })
  })

  it("evaluates abilities on records that pass a subquery-scoped allow rule", async () => {
    await withSubqueryAbilityScope("owner-a", async () => {
      await Dummy.run(async () => {
        configureNodeTransport()

        try {
          await createTaskWithProject({
            creatingUserReference: "owner-a",
            taskName: "In-scope abilities task"
          })
          // The out-of-scope task is unreadable under the subquery
          // scope, so it's filtered out by the authorized index query
          // before abilities run — confirming that `abilities(...)`
          // never attaches results to rows the base ability denies.
          await createTaskWithProject({
            creatingUserReference: "owner-b",
            taskName: "Out-of-scope abilities task"
          })

          const scoped = await Task.query().abilities(["update", "destroy"]).toArray()

          expect(scoped.length).toBe(1)
          expect(scoped[0].name()).toBe("In-scope abilities task")
          expect(scoped[0].can("update")).toBe(true)
          expect(scoped[0].can("destroy")).toBe(true)
        } finally {
          resetFrontendModelTransport()
        }
      })
    })
  })

  it("attaches record.can(action) on the find command", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        const backendTask = await createTaskWithProject({taskName: "Find-with-abilities task"})

        const task = await Task.query().abilities(["update"]).find(backendTask.id())

        expect(task.can("update")).toBe(true)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("accepts the keyed `{ModelName: [actions]}` form for the root model", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await createTaskWithProject({taskName: "Keyed-form task"})

        const tasks = await Task.query().abilities({Task: ["update", "destroy"]}).toArray()

        expect(tasks.length).toBe(1)
        expect(tasks[0].can("update")).toBe(true)
        expect(tasks[0].can("destroy")).toBe(true)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("ignores unknown model names in the keyed form instead of crashing", async () => {
    await Dummy.run(async () => {
      configureNodeTransport()

      try {
        await createTaskWithProject({taskName: "Unknown model key task"})

        const tasks = await Task.query()
          .abilities(/** @type {any} */ ({NoSuchModel: ["update"]}))
          .toArray()

        expect(tasks.length).toBe(1)
        expect(tasks[0].can("update")).toBe(false)
      } finally {
        resetFrontendModelTransport()
      }
    })
  })

  it("rejects malformed action values at the frontend boundary", () => {
    expect(() => {
      Task.query().abilities(/** @type {any} */ ([""]))
    }).toThrow(/abilities flat-form actions must be non-empty strings/)

    expect(() => {
      Task.query().abilities(/** @type {any} */ ({Task: "update"}))
    }).toThrow(/must be an array of action names/)

    expect(() => {
      Task.query().abilities(/** @type {any} */ ({Task: [42]}))
    }).toThrow(/entries must be non-empty strings/)
  })
})
