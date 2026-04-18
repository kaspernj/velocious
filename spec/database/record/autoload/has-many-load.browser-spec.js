import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - autoload - has many load", {tags: ["dummy"]}, () => {
  it("triggers cohort loading when calling .load() on the unscoped has-many instance", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})

    await Task.create({name: "HM load cohort A1", project: projectA})
    await Task.create({name: "HM load cohort B1", project: projectB})

    const projects = await Project.where({id: [projectA.id(), projectB.id()]}).toArray()

    await projects[0].tasks().load()

    // The sibling must be preloaded as part of the cohort batch.
    const siblingRelationship = projects[1].getRelationshipByName("tasks")

    expect(siblingRelationship.getPreloaded()).toEqual(true)
  })

  it("does not trigger cohort loading when calling .load() on a scoped query", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})

    await Task.create({name: "HM scoped A1", project: projectA})
    await Task.create({name: "HM scoped B1", project: projectB})

    const projects = await Project.where({id: [projectA.id(), projectB.id()]}).toArray()

    // Scoped query bypasses the instance relationship and therefore cohort autoload.
    await projects[0].tasks().query().where({name: "HM scoped A1"}).load()

    const siblingRelationship = projects[1].getRelationshipByName("tasks")

    expect(siblingRelationship.getPreloaded()).toEqual(false)
  })
})
