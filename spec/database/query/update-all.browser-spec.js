import Task from "../../dummy/src/models/task.js"
import Project from "../../dummy/src/models/project.js"

describe("Query - updateAll", {tags: ["dummy"]}, () => {
  it("updates only filtered records", async () => {
    const runId = Date.now()
    const project = await Project.create({nameEn: `updateAll-project-${runId}`})
    const task1 = await Task.create({name: `updateAll-match-a-${runId}`, project})
    const task2 = await Task.create({name: `updateAll-keep-${runId}`, project})
    const task3 = await Task.create({name: `updateAll-match-b-${runId}`, project})

    await Task.where({projectId: project.id()}).where(`name LIKE '%updateAll-match%'`).updateAll({name: `updateAll-updated-${runId}`})

    const reloaded1 = await Task.find(task1.id())
    const reloaded2 = await Task.find(task2.id())
    const reloaded3 = await Task.find(task3.id())

    expect(reloaded1.name()).toEqual(`updateAll-updated-${runId}`)
    expect(reloaded2.name()).toEqual(`updateAll-keep-${runId}`)
    expect(reloaded3.name()).toEqual(`updateAll-updated-${runId}`)
  })

  it("handles null values in the update data", async () => {
    const runId = Date.now()
    const project = await Project.create({nameEn: `updateAll-null-${runId}`})
    const task = await Task.create({name: `updateAll-nulltest-${runId}`, description: "has a value", project})

    await Task.where({id: task.id()}).updateAll({description: null})

    const reloaded = await Task.find(task.id())

    expect(reloaded.description()).toEqual(null)
  })

  it("does nothing when the data object is empty", async () => {
    const runId = Date.now()
    const project = await Project.create({nameEn: `updateAll-empty-${runId}`})
    const task = await Task.create({name: `updateAll-nochange-${runId}`, project})

    await Task.where({id: task.id()}).updateAll({})

    const reloaded = await Task.find(task.id())

    expect(reloaded.name()).toEqual(`updateAll-nochange-${runId}`)
  })
})
