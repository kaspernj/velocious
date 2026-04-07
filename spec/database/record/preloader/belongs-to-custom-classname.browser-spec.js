import Project from "../../../dummy/src/models/project.js"
import User from "../../../dummy/src/models/user.js"

describe("Record - preloader - belongs to custom className", {tags: ["dummy"]}, () => {
  it("preloads a belongsTo relationship with a custom className", async () => {
    const user = await User.create({email: "custom-class-user@example.com", encrypted_password: "password", reference: "CustomRef-1"})
    const project = await Project.create({creating_user_reference: "CustomRef-1"})

    const foundProject = /** @type {Project} */ (await Project.preload({creatingUser: true}).find(project.id()))
    const creatingUser = foundProject.creatingUser()

    expect(creatingUser.id()).toEqual(user.id())
    expect(creatingUser.email()).toEqual("custom-class-user@example.com")
  })

  it("preloads a belongsTo with custom className when no related record exists", async () => {
    const project = await Project.create({creating_user_reference: "NonExistentRef-1"})

    const foundProject = /** @type {Project} */ (await Project.preload({creatingUser: true}).find(project.id()))
    const creatingUser = foundProject.creatingUser()

    expect(creatingUser).toBeUndefined()
  })
})
