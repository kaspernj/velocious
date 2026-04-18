import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - autoload - has many", {tags: ["dummy"]}, () => {
  it("batch-loads has-many children for every cohort sibling on first lazy access", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})

    await Task.create({name: "HM autoload A1", project: projectA})
    await Task.create({name: "HM autoload A2", project: projectA})
    await Task.create({name: "HM autoload B1", project: projectB})

    const projects = await Project.where({id: [projectA.id(), projectB.id()]}).toArray()

    expect(projects.length).toEqual(2)

    const firstProjectTasks = await projects[0].tasksOrLoad()

    expect(Array.isArray(firstProjectTasks)).toEqual(true)

    // The sibling must already be preloaded from the cohort's batch load.
    const siblingRelationship = projects[1].getRelationshipByName("tasks")

    expect(siblingRelationship.getPreloaded()).toEqual(true)

    const siblingTasks = projects[1].tasksLoaded()

    expect(Array.isArray(siblingTasks)).toEqual(true)
  })
})
