import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Database - query - model class query", () => {
  it("counts distinct records", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({nameEn: "Project name", nameDe: "Projektname"})
      await Task.create({name: "Task 1", project})

      const rawCount = await Task.joins({project: {translations: true}}).count()
      const distinctCount = await Task.joins({project: {translations: true}}).distinct().count()

      expect(rawCount).toEqual(2)
      expect(distinctCount).toEqual(1)
    })
  })
})
