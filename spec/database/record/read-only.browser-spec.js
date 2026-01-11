import Task from "../../dummy/src/models/task.js"
import Configuration from "../../../src/configuration.js"

describe("Record - read only", {tags: ["dummy"]}, () => {
  it("prevents writes when database is read only", async () => {
    const databaseConfig = Configuration.current().getDatabaseIdentifier("default")
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
