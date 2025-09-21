import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import {ValidationError} from "../../../src/database/record/index.js"

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

      // 'name' is not a column but rather a column on the translation data model.
      expect(() => project.readColumn("name")).toThrowError("No such attribute or not selected Project#name")
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
      const beforeProjectsCount = await Project.count()
      const beforeTasksCount = await Task.count()

      expect(beforeProjectsCount).toEqual(0)
      expect(beforeTasksCount).toEqual(0)

      const project = new Project({name: "Test project"})

      project.tasks().build({name: " ", project})
      project.buildProjectDetail({note: "Test note"})

      try {
        await project.save()

        throw new Error("Didnt expect to succeed")
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect(error.message).toEqual("Name can't be blank")
      }

      const projectsCount = await Project.count()
      const tasksCount = await Task.count()

      expect(projectsCount).toEqual(0)
      expect(tasksCount).toEqual(0)

      const projectNote = project.projectNote()

      expect(projectNote.note()).toEqual("Test note")
      expect(projectNote.projectId()).toEqual(project.id())
    })
  })
})
