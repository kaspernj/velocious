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
})
