import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Record - counterCache", {tags: ["dummy"]}, () => {
  it("increments parent count on create", async () => {
    const project = await Project.create()

    await Task.create({name: "Counter task 1", project})
    await Task.create({name: "Counter task 2", project})

    await project.reload()

    expect(project.tasksCount()).toEqual(2)
  })

  it("decrements parent count on destroy", async () => {
    const project = await Project.create()
    const task1 = await Task.create({name: "Counter destroy 1", project})
    await Task.create({name: "Counter destroy 2", project})

    await task1.destroy()
    await project.reload()

    expect(project.tasksCount()).toEqual(1)
  })

  it("syncs both old and new parent on FK change", async () => {
    const projectA = await Project.create()
    const projectB = await Project.create()
    const task = await Task.create({name: "Counter move", project: projectA})

    await projectA.reload()

    expect(projectA.tasksCount()).toEqual(1)

    await task.update({projectId: projectB.id()})

    await projectA.reload()
    await projectB.reload()

    expect(projectA.tasksCount()).toEqual(0)
    expect(projectB.tasksCount()).toEqual(1)
  })
})
