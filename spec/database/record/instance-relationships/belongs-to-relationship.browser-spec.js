import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"
import Comment from "../../../dummy/src/models/comment.js"
import User from "../../../dummy/src/models/user.js"

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

  it("normalizes explicit camelCase foreign keys to database column names", async () => {
    const project = await Project.create({name: "Camel foreign key project"})
    const task = await Task.create({name: "Camel foreign key task", reviewProject: project})

    expect(task.projectId()).toEqual(project.id())
    expect(task.reviewProject().id()).toEqual(project.id())

    const reloadedTask = /** @type {Task} */ (await Task.find(task.id()))

    expect((await reloadedTask.reviewProjectOrLoad())?.id()).toEqual(project.id())
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

    await task.projectOrLoad()
    task.setProjectId(project.id())

    expect(task.project().name()).toEqual("Matching loaded project")
  })

  it("tracks foreign key changes when assigning a belongs-to relationship", async () => {
    const originalProject = await Project.create({name: "Original setter project"})
    const targetProject = await Project.create({name: "Target setter project"})
    const task = await Task.create({name: "Relationship setter task", project: originalProject})

    task.setProject(targetProject)

    expect(task.projectId()).toEqual(targetProject.id())
    expect(task.changes().project_id).toEqual([originalProject.id(), targetProject.id()])
  })

  it("uses the relationship primary key when assigning a belongs-to relationship", async () => {
    const creator = await User.create({email: "creator-primary-key@example.com", encryptedPassword: "secret", reference: "creator-reference"})
    const project = await Project.create({name: "Custom primary key relationship project"})

    project.setCreatingUser(creator)

    expect(project.creatingUserReference()).toEqual("creator-reference")
    expect(project.changes().creating_user_reference).toEqual([null, "creator-reference"])
  })

  it("preloads translations when explicitly requested for a reloaded changed belongs-to foreign key", async () => {
    const originalProject = await Project.create({name: "Original translated project"})
    const targetProject = await Project.create({name: "Target translated project"})
    const task = await Task.create({name: "Changed translated relationship task", project: originalProject})

    await task.projectOrLoad()
    task.setProjectId(targetProject.id())

    await task.relationshipOrLoad("project", {preloadTranslations: true})

    expect(task.project().name()).toEqual("Target translated project")
  })

  it("does not treat a saved foreign key as a loaded belongs-to relationship", async () => {
    const project = await Project.create({name: "Assigned foreign key project"})
    const task = await Task.create({name: "Assigned foreign key task", projectId: project.id()})

    expect(() => task.project()).toThrowError("Task#project hasn't been preloaded")

    const loadedProject = await task.projectOrLoad()

    expect(loadedProject?.id()).toEqual(project.id())
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
