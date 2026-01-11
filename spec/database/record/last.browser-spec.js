import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - last", {tags: ["dummy"]}, () => {
  it("finds the last record", async () => {
    const project1 = await Project.create()

    await Task.create({name: "Test task 1", project: project1})
    await Task.create({name: "Test task 2", project: project1})
    await Task.create({name: "Test task 3", project: project1})

    const project2 = await Project.create()

    await Task.create({name: "Test task 4", project: project2})
    await Task.create({name: "Test task 5", project: project2})
    await Task.create({name: "Test task 6", project: project2})

    const foundTask = /** @type {Task} */ (await Task.last())

    expect(foundTask.name()).toEqual("Test task 6")

    const foundTaskWithFilter = /** @type {Task} */ (await Task.where({project_id: project1.id()}).last())

    expect(foundTaskWithFilter.name()).toEqual("Test task 3")
  })
})
