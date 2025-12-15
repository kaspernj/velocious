import Dummy from "../../../dummy/index.js"
import Project from "../../../dummy/src/models/project.js"
import User from "../../../dummy/src/models/user.js"

describe("Record - preloader - belongs to", () => {
  it("loads with custom primary key and foreign key", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({creating_user_reference: "User-65"})
      const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
      const foundProject = /** @type {Project} */ (await Project.preload({creatingUser: true}).find(project.id()))

      expect(foundProject.creatingUser().id()).toEqual(user.id())
    })
  })
})
