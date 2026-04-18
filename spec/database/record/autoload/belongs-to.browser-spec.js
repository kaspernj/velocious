import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - autoload - belongs to", {tags: ["dummy"]}, () => {
  it("batch-loads the belongs-to relationship for every cohort sibling on first lazy access", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})

    await Task.create({name: "Autoload task A", project: projectA})
    await Task.create({name: "Autoload task B", project: projectB})

    const tasks = await Task.where({name: ["Autoload task A", "Autoload task B"]}).toArray()

    expect(tasks.length).toEqual(2)

    const firstProject = await tasks[0].projectOrLoad()

    expect(firstProject).toBeTruthy()

    // Sibling must already be marked preloaded — the single call to projectOrLoad()
    // above should have batched the load for both cohort members.
    const siblingRelationship = tasks[1].getRelationshipByName("project")

    expect(siblingRelationship.getPreloaded()).toEqual(true)
    expect(tasks[1].project().id()).toBeTruthy()
  })

  it("resolves cohort siblings from a single cohort query", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})
    const taskA = await Task.create({name: "Cohort A", project: projectA})
    const taskB = await Task.create({name: "Cohort B", project: projectB})

    const tasks = await Task.where({name: ["Cohort A", "Cohort B"]}).toArray()
    const resolvedProjectA = await tasks.find((task) => task.id() === taskA.id()).projectOrLoad()
    const resolvedProjectB = tasks.find((task) => task.id() === taskB.id()).project()

    expect(resolvedProjectA.id()).toEqual(projectA.id())
    expect(resolvedProjectB.id()).toEqual(projectB.id())
  })
})
