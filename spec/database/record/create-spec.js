// @ts-check

import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import {ValidationError} from "../../../src/database/record/index.js"
import ProjectDetail from "../../dummy/src/models/project-detail.js"

describe("Record - create", () => {
  it("creates a new simple record with relationships and translations", async () => {
    await Dummy.run(async () => {
      const task = new Task({name: "Test task"})
      const project = task.buildProject({nameEn: "Test project", nameDe: "Test projekt"})

      project.buildProjectDetail({note: "Test note"})

      expect(task.hasName()).toBeTrue()
      expect(task.hasCreatedAt()).toBeFalse()
      expect(project.hasName()).toBeTrue()
      expect(project.hasNameEn()).toBeTrue()
      expect(project.hasNameDe()).toBeTrue()
      expect(project.hasUpdatedAt()).toBeFalse()

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


      // It saves a project note through a has one relationship
      const projectDetail = project.projectDetail()

      expect(projectDetail.isNewRecord()).toBeFalse()
      expect(projectDetail.isPersisted()).toBeTrue()
      expect(projectDetail.note()).toEqual("Test note")
      expect(projectDetail.projectId()).toEqual(project.id())


      // It automatically sets the relationship that saved it on a has-one-relationship
      const projectInstanceRelationship = projectDetail.getRelationshipByName("project")

      expect(projectInstanceRelationship.getPreloaded()).toBeTrue()
      expect(projectDetail.project().id()).toEqual(project.id())


      // It automatically sets the relationship that saved it on a has-many-relationship
      const tasksRelationship = project.getRelationshipByName("tasks")

      expect(tasksRelationship.getPreloaded()).toBeTrue()

      const projectTasksIDs = project.tasksLoaded().map((task) => task.id())

      expect(projectTasksIDs).toEqual([task.id()])
    })
  })

  it("sets the inversed relationship on has-many-relationships", async () => {
    const project = new Project({name: "Test project"})

    project.tasks().build({name: "Test task 1"})
    project.tasks().build({name: "Test task 2"})

    await project.save()

    const tasks = project.tasksLoaded()
    const task1 = tasks.find((task) => task.name() == "Test task 1")
    const task2 = tasks.find((task) => task.name() == "Test task 2")

    expect(tasks.length).toEqual(2)

    expect(task1?.projectId()).toEqual(project.id())
    expect(task1?.project().id()).toEqual(project.id())

    expect(task2?.projectId()).toEqual(project.id())
    expect(task2?.project().id()).toEqual(project.id())
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

        if (error instanceof Error) {
          expect(error.message).toEqual("Name can't be blank")
        } else {
          throw new Error(`Expected error to be an instance of Error: ${typeof error}`)
        }
      }

      const projectsCount = await Project.count()
      const projectDetailsCount = await ProjectDetail.count()
      const tasksCount = await Task.count()

      expect(projectsCount).toEqual(0)
      expect(projectDetailsCount).toEqual(0)
      expect(tasksCount).toEqual(0)
    })
  })
})
