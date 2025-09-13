import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import {ValidationError} from "../../src/database/record/index.js"

describe("database - transactions", () => {
  it("supports transactions and savepoints", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
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
              expect(error.message).toEqual("Name can't be blank")
            }
          })
        })
      })

      const tasksCount = await Task.count()

      expect(tasksCount).toEqual(2)
    })
  })
})
