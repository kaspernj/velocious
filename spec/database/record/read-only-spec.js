import Dummy from "../../dummy/index.js"
import Task from "../../dummy/src/models/task.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"

describe("Record - read only", () => {
  it("prevents writes when database is read only", async () => {
    await Dummy.run(async () => {
      const databaseConfig = dummyConfiguration.getDatabaseIdentifier("default")
      const previousReadOnly = databaseConfig.readOnly

      databaseConfig.readOnly = true

      try {
        let error

        try {
          await Task.create({name: "Blocked task"})
        } catch (caughtError) {
          error = caughtError
        }

        expect(error).toBeInstanceOf(Error)
        expect(error?.message).toContain("read-only")
      } finally {
        databaseConfig.readOnly = previousReadOnly
      }
    })
  })
})
