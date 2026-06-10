import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - instance relationships - belongs to relationship", {tags: ["dummy"]}, () => {
  it("loads a relationship", async () => {
    const project = await Project.create()
    const task = await Task.create({name: "Test task", project})
    const foundTask = /** @type {Task} */ (await Task.find(task.id()))
    const projectInstanceRelationship = foundTask.getRelationshipByName("project")

    expect(projectInstanceRelationship.isLoaded()).toBeFalse()

    await foundTask.loadProject()

    expect(projectInstanceRelationship.isLoaded()).toBeTrue()
    expect(foundTask.project().id()).toEqual(project.id())
  })

  it("force reloads a belongs-to relationship after the foreign key changes", async () => {
    const originalProject = await Project.create()
    const targetProject = await Project.create()
    const task = await Task.create({name: "Changed relationship task", project: originalProject})

    await task.projectOrLoad()
    expect(task.project().id()).toEqual(originalProject.id())

    task.setProjectId(targetProject.id())
    await task.preload("project", {force: true})

    expect(task.project().id()).toEqual(targetProject.id())
  })

  it("clears a loaded belongs-to relationship when the foreign key changes", async () => {
    const originalProject = await Project.create()
    const targetProject = await Project.create()
    const task = await Task.create({name: "Cleared relationship task", project: originalProject})

    await task.projectOrLoad()
    expect(task.project().id()).toEqual(originalProject.id())

    task.setProjectId(targetProject.id())
    const reloadedProject = await task.projectOrLoad()

    expect(reloadedProject?.id()).toEqual(targetProject.id())
    expect(task.project().id()).toEqual(targetProject.id())
  })

  it("force reloads a changed belongs-to relationship inside lifecycle callbacks", async () => {
    const previousLifecycleCallbacks = Task._lifecycleCallbacks
    const originalProject = await Project.create({name: "Lifecycle original project"})
    const targetProject = await Project.create({name: "Lifecycle target project"})
    const task = await Task.create({name: "Lifecycle relationship task", project: originalProject})
    let callbackProjectId

    await task.projectOrLoad()
    expect(task.project().id()).toEqual(originalProject.id())

    Task._lifecycleCallbacks = {}
    Task.beforeValidation(async (record) => {
      await record.preload("project", {force: true})
      callbackProjectId = record.project().id()
    })

    try {
      await task.update({projectId: targetProject.id()})

      expect(callbackProjectId).toEqual(targetProject.id())
      expect(task.project().id()).toEqual(targetProject.id())
    } finally {
      Task._lifecycleCallbacks = previousLifecycleCallbacks
    }
  })
})
