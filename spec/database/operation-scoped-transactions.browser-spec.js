// @ts-check

import Configuration from "../../src/configuration.js"
import Project from "../dummy/src/models/project.js"
import recordChanges from "../../src/database/record-changes.js"
import Task from "../dummy/src/models/task.js"

class OtherDatabaseProject extends Project {}
OtherDatabaseProject.setDatabaseIdentifier("mssql")

describe("database - operation-scoped transactions", {tags: ["dummy"], databaseCleaning: {transaction: false}}, () => {
  it("rolls back operation-owned creates, updates, and destroys", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Operation rollback project"})
    const updatedTask = await Task.create({name: "Before operation update", project})
    const destroyedTask = await Task.create({name: "Before operation destroy", project})
    /** @type {import("../../src/database/record-changes.js").RecordChangeEvent[]} */
    const changeEvents = []
    const unsubscribe = recordChanges.subscribe(Task, (event) => {
      changeEvents.push(event)
    })

    try {
      await expect(async () => {
        await configuration.withTransaction({databaseIdentifier: "default", name: "rollback owned writes"}, async (operation) => {
          const Tasks = operation.forModel(Task)

          await Tasks.create({name: "Rolled-back create", project})

          const ownedUpdatedTask = await Tasks.find(updatedTask.id())
          ownedUpdatedTask.assign({name: "Rolled-back update"})
          await ownedUpdatedTask.save()

          const ownedDestroyedTask = await Tasks.find(destroyedTask.id())
          await ownedDestroyedTask.destroy()

          throw new Error("ROLLBACK_OWNED_WRITES")
        })
      }).toThrowError("ROLLBACK_OWNED_WRITES")
    } finally {
      unsubscribe()
    }

    expect(await Task.findBy({name: "Rolled-back create"})).toBeNull()
    expect((await Task.find(updatedTask.id())).name()).toEqual("Before operation update")
    expect((await Task.find(destroyedTask.id())).name()).toEqual("Before operation destroy")
    expect(changeEvents).toHaveLength(0)
  })

  it("leases concurrent operations in FIFO order", async () => {
    const configuration = Configuration.current()
    /** @type {() => void} */
    let releaseFirst = () => {}
    let firstEnteredResolve = () => {}
    const firstEntered = new Promise((resolve) => {
      firstEnteredResolve = () => resolve(undefined)
    })
    const firstGate = new Promise((resolve) => {
      releaseFirst = () => resolve(undefined)
    })
    /** @type {string[]} */
    const order = []
    const firstOperation = configuration.withTransaction({databaseIdentifier: "default"}, async () => {
      order.push("first-enter")
      firstEnteredResolve()
      await firstGate
      order.push("first-exit")
    })

    await firstEntered

    const secondOperation = configuration.withTransaction({databaseIdentifier: "default"}, async () => {
      order.push("second-enter")
    })

    await Promise.resolve()
    expect(order).toEqual(["first-enter"])

    releaseFirst()
    await firstOperation
    await secondOperation

    expect(order).toEqual(["first-enter", "first-exit", "second-enter"])
  })

  it("releases the lease after query and post-commit failures", async () => {
    const configuration = Configuration.current()

    await expect(async () => {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.connection().query("SELECT * FROM operation_table_that_does_not_exist")
      })
    }).toThrow(/operation_table_that_does_not_exist/u)

    await expect(async () => {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.afterCommit(() => {
          throw new Error("POST_COMMIT_OPERATION_FAILURE")
        })
      })
    }).toThrowError("POST_COMMIT_OPERATION_FAILURE")

    expect((await Project.create({name: "Lease released after failures"})).isPersisted()).toBeTrue()
  })

  it("reuses the pool sequentially and rejects an expired operation handle", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Sequential operation project"})
    let expiredOperation

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      expiredOperation = operation
      await operation.forModel(Task).create({name: "Sequential first", project})
    })

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      await operation.forModel(Task).create({name: "Sequential second", project})
    })

    if (!expiredOperation) throw new Error("Operation handle was not captured")

    expect(() => expiredOperation.forModel(Task)).toThrowError("Database operation has completed")
    expect(await Task.findBy({name: "Sequential first"})).toBeDefined()
    expect(await Task.findBy({name: "Sequential second"})).toBeDefined()
  })

  it("rejects models assigned to another database", async () => {
    const configuration = Configuration.current()

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      expect(() => operation.forModel(OtherDatabaseProject)).toThrowError("OtherDatabaseProject uses database \"mssql\", not operation database \"default\"")
    })
  })

  it("preserves ownership through relationships, preloads, lifecycle saves, and autosaves", async () => {
    const configuration = Configuration.current()
    const existingProject = await Project.create({name: "Preload ownership project"})
    await Task.create({name: "Before preload update", project: existingProject})
    /** @type {number | string | undefined} */
    let rolledBackProjectId

    await expect(async () => {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        const Projects = operation.forModel(Project)
        const builtProject = Projects.build({name: "Autosave rollback project"})

        builtProject.tasks().build({name: "Autosave rollback task"})
        await builtProject.save()
        rolledBackProjectId = builtProject.id()

        const loadedProject = await Projects
          .preload("tasks")
          .withCount("tasks")
          .find(existingProject.id())
        const [loadedTask] = loadedProject.tasksLoaded()

        expect(loadedProject.readCount("tasksCount")).toEqual(1)
        loadedTask.assign({name: "Preload rollback update"})
        await loadedTask.save()

        throw new Error("ROLLBACK_PROPAGATION")
      })
    }).toThrowError("ROLLBACK_PROPAGATION")

    if (rolledBackProjectId === undefined) throw new Error("Rolled-back project ID was not captured")

    expect(await Project.findBy({id: rolledBackProjectId})).toBeNull()
    expect(await Task.findBy({name: "Autosave rollback task"})).toBeNull()
    expect(await Task.findBy({name: "Preload rollback update"})).toBeNull()
    const survivingTask = await Task.findBy({name: "Before preload update"})

    if (!survivingTask) throw new Error("Original task did not survive operation rollback")
  })
})
