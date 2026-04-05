import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"

describe("Record - find", {tags: ["dummy"]}, () => {
  it("finds an existing record", async () => {
    const project = await Project.create()
    const task = new Task({name: "Test task", project})

    await task.save()

    const foundTask = /** @type {Task} */ (await Task.find(task.id()))

    expect(foundTask.readAttribute("name")).toEqual("Test task")
    expect(foundTask.readColumn("name")).toEqual("Test task")
    expect(foundTask.hasName()).toBeTrue()
  })

  it("raises an error when a record isn't found", async () => {
    try {
      await Task.find(123)
      throw new Error("Didn't expect to reach this")
    } catch (error) {
      expect(error.message).toEqual("Couldn't find Task with 'id'=123")
      expect(error.constructor.name).toEqual("RecordNotFoundError")
    }
  })

  it("resolves camelCase attribute names to column names in findBy", async () => {
    const project = await Project.create()
    const task = await Task.create({name: "findBy column resolve", project})

    const found = await Task.findBy({projectId: project.id()})

    expect(found).toBeTruthy()
    expect(found?.id()).toEqual(task.id())
  })

  it("resolves camelCase attribute names to column names in findByOrFail", async () => {
    const project = await Project.create()
    const task = await Task.create({name: "findByOrFail column resolve", project})

    const found = await Task.findByOrFail({projectId: project.id()})

    expect(found.id()).toEqual(task.id())
  })

  it("treats numeric ids as strings for uuid primary keys", async () => {
    try {
      await UuidItem.find(1)
      throw new Error("Didn't expect to reach this")
    } catch (error) {
      expect(error.constructor.name).toEqual("RecordNotFoundError")
      expect(error.message).toEqual("Couldn't find UuidItem with 'id'=1")
    }
  })
})
