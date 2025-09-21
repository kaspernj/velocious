import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - query", () => {
  it("queries for records", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})
      const project = task.buildProject({nameEn: "Test project", nameDe: "Test projekt"})

      project.buildProjectDetail({note: "Test note"})

      await task.save()

      expect(task.id()).not.toBeUndefined()
      expect(task.name()).toEqual("Test task")
      expect(task.project().id()).toEqual(project.id())
      expect(task.project()).toEqual(project)

      expect(project.id()).not.toBeUndefined()
      expect(project.name()).toEqual("Test project")
      expect(project.nameDe()).toEqual("Test projekt")
      expect(project.nameEn()).toEqual("Test project")

      const tasks = await Task.preload({project: {projectDetail: true, translations: true}}).toArray()
      const newTask = tasks[0]
      const newProject = newTask.project()
      const newProjectDetail = newProject.projectDetail()

      expect(newTask.id()).not.toBeUndefined()
      expect(newTask.name()).toEqual("Test task")
      expect(task.project().id()).toEqual(newProject.id())
      expect(newTask.project()).toEqual(newProject)

      expect(newProject.id()).not.toBeUndefined()
      expect(newProject.name()).toEqual("Test project")
      expect(newProject.nameDe()).toEqual("Test projekt")
      expect(newProject.nameEn()).toEqual("Test project")

      expect(newProjectDetail.note()).toEqual("Test note")
    })
  })

  it("finds the first record", async () => {
    await Dummy.run(async () => {
      const taskIDs = []
      const project = await Project.create()

      for (let i = 0; i < 5; i++) {
        const task = await Task.create({name: `Task ${i}`, project})

        taskIDs.push(task.id())
      }

      const lastTask = await Task.first()

      expect(lastTask.id()).toEqual(taskIDs[0])
    })
  })

  it("finds the last record", async () => {
    await Dummy.run(async () => {
      const taskIDs = []
      const project = await Project.create()

      for (let i = 0; i < 5; i++) {
        const task = await Task.create({name: `Task ${i}`, project})

        taskIDs.push(task.id())
      }

      const lastTask = await Task.last()

      expect(lastTask.id()).toEqual(taskIDs[4])
    })
  })

  it("counts the records", async () => {
    await Dummy.run(async () => {
      const taskIDs = []
      const project = await Project.create()

      for (let i = 0; i < 5; i++) {
        const task = await Task.create({name: `Task ${i}`, project})

        taskIDs.push(task.id())
      }

      const tasksCount = await Task.count()

      expect(tasksCount).toEqual(5)
    })
  })
})
