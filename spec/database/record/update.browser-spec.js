import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import wait from "awaitery/build/wait.js"

describe("Record - update", {tags: ["dummy"]}, () => {
  it("updates a record", async () => {
    const project = await Project.create()
    const task = new Task({name: "Test task", project})

    await task.save()
    await task.update({name: "Updated name"})

    expect(task.readAttribute("name")).toEqual("Updated name")
  })

  it("updates a record with timestamps", async () => {
    const project = new Project({name: "Test project"})

    await project.save()
    await wait(1000)
    await project.update({name: "Updated name"})

    expect(project.name()).toEqual("Updated name")
    expect(project.updatedAt()).not.toEqual(project.createdAt())
  })
})
