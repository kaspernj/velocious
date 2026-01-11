import Project from "../../../dummy/src/models/project.js"
import ProjectDetail from "../../../dummy/src/models/project-detail.js"

describe("Record - instance relationships - has one relationship", {tags: ["dummy"]}, () => {
  it("loads a relationship", async () => {
      const project = await Project.create()
      const projectDetail = await ProjectDetail.create({note: "Test project", project})
      const foundProject = /** @type {Project} */ (await Project.find(project.id()))
      const projectDetailInstanceRelationship = foundProject.getRelationshipByName("projectDetail")

      expect(projectDetailInstanceRelationship.isLoaded()).toBeFalse()

      await foundProject.loadProjectDetail()

      expect(projectDetailInstanceRelationship.isLoaded()).toBeTrue()

      const projectsLoadedProjectDetail = foundProject.projectDetail()

      expect(projectsLoadedProjectDetail.id()).toEqual(projectDetail.id())
  })
})
