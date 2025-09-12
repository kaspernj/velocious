import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import Task from "../dummy/src/models/task.js"
import {ValidationError} from "../../src/database/record/index.js"

describe("database - transactions", () => {
  it("supports transactions and savepoints", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.withConnections(async (dbs) => {
        const db = dbs.default

        await db.transaction(async () => {
          await Task.create({name: "Task 1"})

          await db.transaction(async () => {
            await Task.create({name: "Task 2"})

            try {
              await db.transaction(async () => {
                await Task.create({name: "Task 3"})
                await Task.create({name: "    "})

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
