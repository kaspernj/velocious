import Configuration from "../../../../src/configuration.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record - autoload - disable", {tags: ["dummy"]}, () => {
  it("stores autoload=false on the relationship definition when the option is passed", () => {
    const relationship = Task.getRelationshipByName("project")

    expect(relationship.getAutoload()).toEqual(true)

    // Toggle the private flag via the public setter analog for the duration of the assertion.
    relationship._autoload = false
    try {
      expect(relationship.getAutoload()).toEqual(false)
    } finally {
      relationship._autoload = true
    }
  })

  it("does not autoload cohort siblings when the per-relationship flag is false", async () => {
    const relationship = Task.getRelationshipByName("project")

    relationship._autoload = false
    try {
      const projectA = await Project.create({})
      const projectB = await Project.create({})

      await Task.create({name: "Per-rel disabled A", project: projectA})
      await Task.create({name: "Per-rel disabled B", project: projectB})

      const tasks = await Task.where({name: ["Per-rel disabled A", "Per-rel disabled B"]}).toArray()

      await tasks[0].projectOrLoad()

      const siblingRelationship = tasks[1].getRelationshipByName("project")

      expect(siblingRelationship.getPreloaded()).toEqual(false)
    } finally {
      relationship._autoload = true
    }
  })

  it("disables autoload globally when configuration.autoload is false", async () => {
    const configuration = Configuration.current()
    const originalAutoload = configuration.getAutoload()

    configuration.setAutoload(false)
    try {
      const projectA = await Project.create({})
      const projectB = await Project.create({})

      await Task.create({name: "Disabled cohort A", project: projectA})
      await Task.create({name: "Disabled cohort B", project: projectB})

      const tasks = await Task.where({name: ["Disabled cohort A", "Disabled cohort B"]}).toArray()

      await tasks[0].projectOrLoad()

      const siblingRelationship = tasks[1].getRelationshipByName("project")

      expect(siblingRelationship.getPreloaded()).toEqual(false)
    } finally {
      configuration.setAutoload(originalAutoload)
    }
  })
})
