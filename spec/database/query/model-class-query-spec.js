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

  it("counts distinct records across groups without collapsing counts", async () => {
    await Dummy.run(async () => {
      const project1 = await Project.create({nameEn: "Alpha", nameDe: "Alfa"})
      const project2 = await Project.create({nameEn: "Beta", nameDe: "Beta"})

      await Task.create({name: "Task 1", project: project1})
      await Task.create({name: "Task 2", project: project1})
      await Task.create({name: "Task 3", project: project2})
      await Task.create({name: "Task 4", project: project2})

      const count = await Task.group("tasks.project_id").distinct().count()

      expect(count).toEqual(4)
    })
  })
})
