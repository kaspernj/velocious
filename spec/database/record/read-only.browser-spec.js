import Task from "../../dummy/src/models/task.js"
import Configuration from "../../../src/configuration.js"
import Project from "../../dummy/src/models/project.js"

describe("Record - read only", {tags: ["dummy"]}, () => {
  it("prevents writes when database is read only", async () => {
    const databaseConfig = Configuration.current().getDatabaseIdentifier("default")
    const previousReadOnly = databaseConfig.readOnly
    const project = await Project.create({name: "Read-only project"})

    databaseConfig.readOnly = true

    try {
      let error

      try {
        await Task.create({name: "Blocked task", projectId: project.id()})
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
