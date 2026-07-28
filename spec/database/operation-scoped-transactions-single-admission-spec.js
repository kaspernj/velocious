// @ts-check

import Configuration from "../../src/configuration.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"

describe("database - operation-scoped transactions - SingleMultiUsePool admission", {tags: ["dummy"], databaseCleaning: {transaction: false}}, () => {
  it("rejects admission while an unrelated ordinary transaction owns the connection", async () => {
    const configuration = Configuration.current()
    const project = await Project.create({name: "Operation admission project"})
    let rejectedOperationError
    let rejectedOperationCallbackRuns = 0
    let rejectedOperationAfterCommitRuns = 0

    await expect(async () => {
      await Project.transaction(async () => {
        try {
          await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
            rejectedOperationCallbackRuns++
            await operation.forModel(Task).create({name: "Must not join held transaction", project})
            await operation.afterCommit(() => {
              rejectedOperationAfterCommitRuns++
            })
          })
        } catch (error) {
          rejectedOperationError = error
        }

        throw new Error("ROLLBACK_HELD_ORDINARY_TRANSACTION")
      })
    }).toThrowError("ROLLBACK_HELD_ORDINARY_TRANSACTION")

    expect(rejectedOperationError instanceof Error ? rejectedOperationError.message : undefined).toContain("ordinary transaction is already active")
    expect(rejectedOperationCallbackRuns).toEqual(0)
    expect(rejectedOperationAfterCommitRuns).toEqual(0)
    expect(await Task.findBy({name: "Must not join held transaction"})).toBeNull()

    let survivingAfterCommitRuns = 0

    await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
      await operation.forModel(Task).create({name: "Operation admitted after rollback", project})
      await operation.afterCommit(() => {
        survivingAfterCommitRuns++
      })
    })

    expect(await Task.findBy({name: "Operation admitted after rollback"})).toBeDefined()
    expect(survivingAfterCommitRuns).toEqual(1)
  })
})
