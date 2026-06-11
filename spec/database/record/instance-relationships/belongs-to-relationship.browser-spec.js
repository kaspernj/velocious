import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"
import Comment from "../../../dummy/src/models/comment.js"

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

    expect(task.project().id()).toEqual(originalProject.id())

    task.setProjectId(targetProject.id())
    await task.loadProject()

    expect(task.project().id()).toEqual(targetProject.id())
  })

  it("keeps matching loaded belongs-to relationships usable after assigning the same foreign key", async () => {
    const project = await Project.create({name: "Matching loaded project"})
    const task = await Task.create({name: "Matching foreign key task", project})
    const loadedProject = await task.projectOrLoad()

    loadedProject?.getRelationshipByName("translations").setPreloaded(false)
    task.setProjectId(project.id())

    expect((await task.projectOrLoad())?.id()).toEqual(project.id())
    expect(task.project().name()).toEqual("Matching loaded project")
  })

  it("clears a loaded belongs-to relationship when the foreign key changes", async () => {
    const originalProject = await Project.create()
    const targetProject = await Project.create()
    const task = await Task.create({name: "Cleared relationship task", project: originalProject})

    expect(task.project().id()).toEqual(originalProject.id())

    task.setProjectId(targetProject.id())
    const reloadedProject = await task.projectOrLoad()

    expect(reloadedProject?.id()).toEqual(targetProject.id())
    expect(task.project().id()).toEqual(targetProject.id())
  })

  it("returns an assigned belongs-to relationship before a new record is saved", async () => {
    const project = await Project.create()
    const task = new Task({name: "Unsaved assigned relationship task", project})

    expect(task.projectId()).toEqual(project.id())

    const loadedProject = await task.projectOrLoad()

    expect(loadedProject?.id()).toEqual(project.id())
  })

  it("returns undefined for an unloaded belongs-to relationship with no foreign key", async () => {
    const task = new Task({name: "Unsaved task without relationship"})

    const loadedProject = await task.projectOrLoad()

    expect(loadedProject).toBeUndefined()
  })

  it("keeps assigned belongs-to relationships available inside create lifecycle callbacks", async () => {
    const previousLifecycleCallbacks = Task._lifecycleCallbacks
    const project = await Project.create()
    let callbackProjectId

    Task._lifecycleCallbacks = {}
    Task.beforeValidation(async (task) => {
      callbackProjectId = (await task.projectOrLoad())?.id()
    })

    try {
      await Task.create({name: "Lifecycle assigned relationship task", project})

      expect(callbackProjectId).toEqual(project.id())
    } finally {
      Task._lifecycleCallbacks = previousLifecycleCallbacks
    }
  })

  it("keeps assigned belongs-to relationships available from OrLoad inside create lifecycle callbacks", async () => {
    const previousLifecycleCallbacks = Comment._lifecycleCallbacks
    const project = await Project.create()
    const task = await Task.create({name: "Comment parent task", project})
    let callbackTaskId

    Comment._lifecycleCallbacks = {}
    Comment.beforeValidation(async (comment) => {
      callbackTaskId = (await comment.taskOrLoad())?.id()
    })

    try {
      await Comment.create({body: "Comment body", task})

      expect(callbackTaskId).toEqual(task.id())
    } finally {
      Comment._lifecycleCallbacks = previousLifecycleCallbacks
    }
  })

  it("force reloads a changed belongs-to relationship inside lifecycle callbacks", async () => {
    const previousLifecycleCallbacks = Task._lifecycleCallbacks
    const originalProject = await Project.create({name: "Lifecycle original project"})
    const targetProject = await Project.create({name: "Lifecycle target project"})
    const task = await Task.create({name: "Lifecycle relationship task", project: originalProject})
    let callbackProjectId

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
