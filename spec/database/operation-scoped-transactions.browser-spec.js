// @ts-check

import Configuration from "../../src/configuration.js"
import Project from "../dummy/src/models/project.js"
import recordChanges from "../../src/database/record-changes.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
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

  it("holds an unrelated write behind the single-pool lease and commits it after rollback", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Operation barrier project"})
    let survivorFinished = false
    /** @type {Promise<Task> | undefined} */
    let survivorPromise

    await expect(async () => {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.forModel(Task).create({name: "Must roll back", project})

        survivorPromise = Task.create({name: "Must survive", project}).then((task) => {
          survivorFinished = true
          return task
        })

        await Promise.resolve()
        await Promise.resolve()

        expect(survivorFinished).toBeFalse()
        throw new Error("ROLLBACK_WITH_SURVIVOR")
      })
    }).toThrowError("ROLLBACK_WITH_SURVIVOR")

    if (!survivorPromise) throw new Error("Survivor write was not started")

    await survivorPromise

    expect(await Task.findBy({name: "Must roll back"})).toBeNull()
    expect(await Task.findBy({name: "Must survive"})).toBeDefined()
  })

  it("discards owned afterCommit callbacks and runs an unrelated registration once", async () => {
    const configuration = Configuration.current()
    let ownedRuns = 0
    let unrelatedRuns = 0
    /** @type {Promise<void> | undefined} */
    let unrelatedPromise

    await expect(async () => {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.afterCommit(() => {
          ownedRuns++
        })

        unrelatedPromise = Project.connection().afterCommit(() => {
          unrelatedRuns++
        })

        await Promise.resolve()
        expect(unrelatedRuns).toEqual(0)

        throw new Error("ROLLBACK_AFTER_COMMIT")
      })
    }).toThrowError("ROLLBACK_AFTER_COMMIT")

    if (!unrelatedPromise) throw new Error("Unrelated afterCommit registration was not started")

    await unrelatedPromise

    expect(ownedRuns).toEqual(0)
    expect(unrelatedRuns).toEqual(1)
  })

  it("supports nested success, nested rollback, and outer rollback", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Nested operation project"})
    let nestedAfterCommitRuns = 0

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      const Tasks = operation.forModel(Task)

      await Tasks.create({name: "Outer success", project})
      await operation.transaction(async () => {
        await Tasks.create({name: "Nested success", project})
        await operation.afterCommit(() => {
          nestedAfterCommitRuns++
        })
      })
      expect(nestedAfterCommitRuns).toEqual(0)

      await expect(async () => {
        await operation.transaction(async () => {
          await Tasks.create({name: "Nested rollback", project})
          throw new Error("ROLLBACK_NESTED")
        })
      }).toThrowError("ROLLBACK_NESTED")
    })

    expect(await Task.findBy({name: "Outer success"})).toBeDefined()
    expect(await Task.findBy({name: "Nested success"})).toBeDefined()
    expect(await Task.findBy({name: "Nested rollback"})).toBeNull()
    expect(nestedAfterCommitRuns).toEqual(1)

    await expect(async () => {
      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        const Tasks = operation.forModel(Task)

        await Tasks.create({name: "Outer rollback root", project})
        await operation.transaction(async () => {
          await Tasks.create({name: "Outer rollback nested", project})
        })

        throw new Error("ROLLBACK_OUTER")
      })
    }).toThrowError("ROLLBACK_OUTER")

    expect(await Task.findBy({name: "Outer rollback root"})).toBeNull()
    expect(await Task.findBy({name: "Outer rollback nested"})).toBeNull()
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
        loadedTask.assign({
          descriptionFile: {
            content: "Rolled-back attachment",
            filename: "rolled-back.txt"
          },
          name: "Preload rollback update"
        })
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

    expect(await survivingTask.descriptionFile().listMetadata()).toHaveLength(0)
  })

  it("keeps a single physical connection in SingleMultiUsePool", async () => {
    const configuration = Configuration.current()
    const pool = configuration.getDatabasePool("default")

    if (!(pool instanceof SingleMultiUsePool)) throw new Error("Expected the dummy default database to use SingleMultiUsePool")

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      expect(pool.getDebugSnapshot().connections.length).toEqual(1)
      expect(await operation.connection().query("SELECT 1 AS operation_connection")).toEqual([{operation_connection: 1}])
      expect(pool.getDebugSnapshot().connections.length).toEqual(1)
    })
  })
})
