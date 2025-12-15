import Dummy from "../../../dummy/index.js"
import Project from "../../../dummy/src/models/project.js"
import User from "../../../dummy/src/models/user.js"

describe("Record - preloader - has many", () => {
  it("loads with custom primary key and foreign key", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({creating_user_reference: "User-65"})
      const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
      const foundUser = /** @type {User} */ (await User.preload({createdProjects: true}).find(user.id()))
      const createdProjectsIDs = foundUser.createdProjectsLoaded().map((createdProject) => createdProject.id())

      expect(createdProjectsIDs).toEqual([project.id()])
    })
  })

  it("preloads an empty array if nothing is found", async () => {
    await Dummy.run(async () => {
      // Differenre reference because nothing should be found as a kind of smoke test
      await Project.create({creating_user_reference: "User-69"})

      const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
      const foundUser = /** @type {User} */ (await User.preload({createdProjects: true}).find(user.id()))
      const createdProjectsIDs = foundUser.createdProjectsLoaded().map((createdProject) => createdProject.id())

      expect(createdProjectsIDs).toEqual([])
    })
  })
})
