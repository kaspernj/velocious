// @ts-check

import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import Configuration from "../../src/configuration.js"
import {ValidationError} from "../../src/database/record/index.js"

describe("database - transactions", {tags: ["dummy"]}, () => {
  it("supports transactions and savepoints", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const project = await Project.create()

      await db.transaction(async () => {
        await Task.create({name: "Task 1", project})

        await db.transaction(async () => {
          await Task.create({name: "Task 2", project})

          try {
            await db.transaction(async () => {
              await Task.create({name: "Task 3", project})
              await Task.create({name: "    ", project})

              throw new Error("Didn't expect to succeed")
            })
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError)

            if (error instanceof Error) {
              expect(error.message).toEqual("Name can't be blank")
            } else {
              throw new Error(`'error' wasn't an 'Error': ${typeof error}`, {cause: error})
            }
          }
        })
      })
    })

    const tasksCount = await Task.count()

    expect(tasksCount).toEqual(2)
  })
})
