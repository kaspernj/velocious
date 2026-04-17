import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - destroy", {tags: ["dummy"]}, () => {
  it("destroys a record", async () => {
    const project = await Project.create()
    const task = new Task({name: "Test task", project})

    await task.save()
    await task.destroy()

    const foundTask = await Task.where({id: task.id()}).first()

    expect(foundTask).toEqual(undefined)
  })

  it("destroys all records in a collection", async () => {
    const project = await Project.create()
    const task1 = await Task.create({name: "Test task 1", project})
    const task2 = await Task.create({name: "Test task 2", project})

    await Task.where({id: task1.id()}).destroyAll()

    const foundTask1 = await Task.where({id: task1.id()}).first()
    const foundTask2 = await Task.where({id: task2.id()}).first()

    expect(foundTask1).toEqual(undefined)
    expect(foundTask2).toBeDefined()
  })

  it("destroys dependent translations when destroying a record", async () => {
    const project = await Project.create()
    const TranslationClass = Project.getTranslationClass()

    await TranslationClass.create({projectId: project.id(), locale: "en", name: "English name"})
    await TranslationClass.create({projectId: project.id(), locale: "da", name: "Danish name"})

    const translationsBefore = await TranslationClass.where({projectId: project.id()}).toArray()

    expect(translationsBefore.length).toEqual(2)

    await project.destroy()

    const translationsAfter = await TranslationClass.where({projectId: project.id()}).toArray()

    expect(translationsAfter.length).toEqual(0)
  })

  it("blocks destroy when dependent restrict records exist", async () => {
    const project = await Project.create()
    await Task.create({name: "Blocking task", project})

    await expect(async () => project.destroy()).toThrowError("Cannot delete record because dependent tasks exist")

    const foundProject = await Project.where({id: project.id()}).first()

    expect(foundProject).toBeDefined()
  })

  it("allows destroy when no dependent restrict records exist", async () => {
    const project = await Project.create()

    await project.destroy()

    const foundProject = await Project.where({id: project.id()}).first()

    expect(foundProject).toEqual(undefined)
  })

  it("runs lifecycle callbacks around destroy", async () => {
    const previousLifecycleCallbacks = Task._lifecycleCallbacks
    /** @type {string[]} */
    const events = []

    Task._lifecycleCallbacks = {}
    Task.beforeDestroy((model) => { events.push(`beforeDestroy:${model.name()}`) })
    Task.afterDestroy((model) => { events.push(`afterDestroy:${model.name()}`) })

    try {
      const project = await Project.create()
      const task = await Task.create({name: "Destroy callback task", project})

      await task.destroy()

      expect(events).toEqual([
        "beforeDestroy:Destroy callback task",
        "afterDestroy:Destroy callback task"
      ])
    } finally {
      Task._lifecycleCallbacks = previousLifecycleCallbacks
    }
  })
})
