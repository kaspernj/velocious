import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - destroyAll", {tags: ["dummy"]}, () => {
  it("destroys only filtered records and leaves other models intact", async () => {
      const project1 = await Project.create({nameEn: "Alpha", nameDe: "Alfa"})
      const project2 = await Project.create({nameEn: "Beta", nameDe: "Beta"})
      const task1 = await Task.create({name: "Delete me A", project: project1})
      const task2 = await Task.create({name: "Keep me", project: project1})
      const task3 = await Task.create({name: "Delete me B", project: project2})

      await Task.where({name: "Delete me A", project_id: project1.id()}).destroyAll()

      const foundTask1 = await Task.where({id: task1.id()}).first()
      const foundTask2 = await Task.where({id: task2.id()}).first()
      const foundTask3 = await Task.where({id: task3.id()}).first()
      const projectsCount = await Project.count()

      expect(foundTask1).toEqual(undefined)
      expect(foundTask2).toBeDefined()
      expect(foundTask3).toBeDefined()
      expect(projectsCount).toEqual(2)
  })

  it("destroys all records for a model without deleting related models", async () => {
      const project1 = await Project.create({nameEn: "Project A"})
      const project2 = await Project.create({nameEn: "Project B"})
      await Task.create({name: "Task A", project: project1})
      await Task.create({name: "Task B", project: project2})

      await Task.destroyAll()

      const tasksCount = await Task.count()
      const projectsCount = await Project.count()

      expect(tasksCount).toEqual(0)
      expect(projectsCount).toEqual(2)
  })
})
