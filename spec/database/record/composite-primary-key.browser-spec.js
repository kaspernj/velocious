// @ts-check

import Project from "../../dummy/src/models/project.js"
import Record from "../../../src/database/record/index.js"
import Task from "../../dummy/src/models/task.js"

/** Composite-key view of the dummy tasks table. */
class CompositePrimaryKeyTask extends Record {}

CompositePrimaryKeyTask.setTableName("tasks")
CompositePrimaryKeyTask.setPrimaryKey(["name", "project_id"])

describe("Record - composite primary key", {tags: ["dummy"]}, () => {
  it("keeps scalar primary-key behavior unchanged", async () => {
    const project = await Project.create({name: "Scalar identity project"})
    const task = await Task.create({name: "Scalar identity task", project})

    expect(typeof task.id()).toEqual("number")
    expect((await Task.find(task.id()))?.id()).toEqual(task.id())
  })

  it("creates and finds a record by every composite key component", async () => {
    const project = await Project.create({name: "Composite identity project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite identity task", project_id: project.id()})

    expect(task.id()).toEqual({name: "Composite identity task", project_id: project.id()})

    const foundTask = await CompositePrimaryKeyTask.find({name: "Composite identity task", project_id: project.id()})

    expect(foundTask?.id()).toEqual({name: "Composite identity task", project_id: project.id()})
  })

  it("updates non-key attributes using the persisted composite identity", async () => {
    const project = await Project.create({name: "Composite non-key update project"})
    const task = await CompositePrimaryKeyTask.create({description: "Before", name: "Composite non-key update task", project_id: project.id()})

    await task.update({description: "After"})

    const foundTask = await CompositePrimaryKeyTask.find(task.id())

    expect(foundTask?.readAttribute("description")).toEqual("After")
  })

  it("locates a key-changing update by its persisted identity and reloads by its new identity", async () => {
    const originalProject = await Project.create({name: "Composite original project"})
    const replacementProject = await Project.create({name: "Composite replacement project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite original task", project_id: originalProject.id()})

    await task.update({name: "Composite renamed task", project_id: replacementProject.id()})

    expect(task.id()).toEqual({name: "Composite renamed task", project_id: replacementProject.id()})
    expect(await CompositePrimaryKeyTask.findBy({name: "Composite original task", project_id: originalProject.id()})).toBeNull()
    expect((await CompositePrimaryKeyTask.find(task.id()))?.id()).toEqual(task.id())
  })

  it("destroys a record using every composite key component", async () => {
    const project = await Project.create({name: "Composite destroy project"})
    const task = await CompositePrimaryKeyTask.create({name: "Composite destroy task", project_id: project.id()})
    const identity = task.id()

    await task.destroy()

    expect(await CompositePrimaryKeyTask.findBy(identity)).toBeNull()
  })

  it("rejects malformed composite identities", async () => {
    const invalidIdentities = [
      "Composite task",
      ["Composite task", 1],
      null,
      {name: "Composite task"},
      {name: "Composite task", project_id: 1, extra: true},
      {name: null, project_id: 1},
      {name: "Composite task", project_id: undefined}
    ]

    for (const identity of invalidIdentities) {
      await expect(async () => await CompositePrimaryKeyTask.find(identity)).toThrow(/composite primary key identity/u)
    }
  })
})
