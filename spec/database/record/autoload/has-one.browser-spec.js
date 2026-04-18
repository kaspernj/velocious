import Project from "../../../dummy/src/models/project.js"
import ProjectDetail from "../../../dummy/src/models/project-detail.js"

describe("Record - autoload - has one", {tags: ["dummy"]}, () => {
  it("batch-loads the has-one relationship for every cohort sibling on first lazy access", async () => {
    const projectA = await Project.create({})
    const projectB = await Project.create({})

    await ProjectDetail.create({project: projectA, isActive: true})
    await ProjectDetail.create({project: projectB, isActive: false})

    const projects = await Project.where({id: [projectA.id(), projectB.id()]}).toArray()

    expect(projects.length).toEqual(2)

    await projects[0].projectDetailOrLoad()

    // Sibling must already be preloaded after the first access.
    const siblingRelationship = projects[1].getRelationshipByName("projectDetail")

    expect(siblingRelationship.getPreloaded()).toEqual(true)
    expect(projects[1].projectDetail()).toBeTruthy()
  })
})
