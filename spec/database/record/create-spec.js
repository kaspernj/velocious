import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - create", () => {
  it("creates a new simple record with relationships and translations", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})
      const project = task.buildProject({nameEn: "Test project", nameDe: "Test projekt"})

      await task.save()

      expect(task.id()).not.toBeUndefined()
      expect(task.name()).toEqual("Test task")
      expect(task.project().id()).toEqual(project.id())
      expect(task.project()).toEqual(project)

      expect(project.id()).not.toBeUndefined()
      expect(project.name()).toEqual("Test project")
      expect(project.nameDe()).toEqual("Test projekt")
      expect(project.nameEn()).toEqual("Test project")
      expect(project.createdAt()).toBeInstanceOf(Date)
      expect(project.updatedAt()).toBeInstanceOf(Date)
    })
  })

  it("creates a new task with an existing project", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Test project"})
      const task = new Task({name: "Test task", project})

      await task.save()

      expect(task.id()).not.toBeUndefined()
      expect(task.name()).toEqual("Test task")
      expect(task.project().id()).toEqual(project.id())
      expect(task.project()).toEqual(project)
    })
  })

  it("uses transactions and rolls back in case of an error", async () => {
    await Dummy.run(async () => {
      const project = new Project({name: "Test project"})

      project.tasks().build({name: " ", project})

      try {
        await project.save()

        throw new Error("Didnt expect to succeed")
      } catch (error) {
        expect(error.message).toEqual("Validation failed: Name can't be blank")
      }

      const projectsCount = await Project.count()
      const tasksCount = await Task.count()

      expect(projectsCount).toEqual(0)
      expect(tasksCount).toEqual(0)
    })
  })
})
