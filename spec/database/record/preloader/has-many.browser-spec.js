import Interaction from "../../../dummy/src/models/interaction.js"
import Project from "../../../dummy/src/models/project.js"
import User from "../../../dummy/src/models/user.js"

describe("Record - preloader - has many", {tags: ["dummy"]}, () => {
  it("loads with custom primary key and foreign key", async () => {
    const project = await Project.create({creating_user_reference: "User-65"})
    const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
    const foundUser = /** @type {User} */ (await User.preload({createdProjects: true}).find(user.id()))
    const createdProjectsIDs = foundUser.createdProjectsLoaded().map((createdProject) => createdProject.id())

    expect(createdProjectsIDs).toEqual([project.id()])
  })

  it("preloads an empty array if nothing is found", async () => {
    // Differenre reference because nothing should be found as a kind of smoke test
    await Project.create({creating_user_reference: "User-69"})

    const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
    const foundUser = /** @type {User} */ (await User.preload({createdProjects: true}).find(user.id()))
    const createdProjectsIDs = foundUser.createdProjectsLoaded().map((createdProject) => createdProject.id())

    expect(createdProjectsIDs).toEqual([])
  })

  it("resolves explicit camel case foreign keys against the target model", async () => {
    const project = await Project.create({})
    const task = await project.tasks().create({name: "Review task"})
    const foundProject = /** @type {Project} */ (await Project.preload({reviewTasks: true}).find(project.id()))
    const reviewTasks = /** @type {import("../../../dummy/src/models/task.js").default[]} */ (foundProject.getRelationshipByName("reviewTasks").loaded())

    expect(reviewTasks.map((reviewTask) => reviewTask.id())).toEqual([task.id()])
  })

  it("preloads polymorphic has many relationships", async () => {
    const project = await Project.create({})
    await Interaction.create({kind: "Wrong type", subjectId: project.id(), subjectType: "Task"})
    await Interaction.create({kind: "Other project", subjectId: (await Project.create({})).id(), subjectType: "Project"})

    const expectedInteraction = await Interaction.create({kind: "Correct type", subjectId: project.id(), subjectType: "Project"})
    const foundProject = /** @type {Project} */ (await Project.preload({interactions: true}).find(project.id()))
    const loadedInteractions = /** @type {Interaction[]} */ (foundProject.getRelationshipByName("interactions").loaded())
    const loadedKinds = loadedInteractions.map((interaction) => interaction.kind())

    expect(loadedKinds).toEqual([expectedInteraction.kind()])
  })
})
