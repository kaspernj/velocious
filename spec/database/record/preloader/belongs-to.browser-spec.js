import Interaction from "../../../dummy/src/models/interaction.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"
import User from "../../../dummy/src/models/user.js"

describe("Record - preloader - belongs to", {tags: ["dummy"]}, () => {
  it("loads with custom primary key and foreign key", async () => {
    const project = await Project.create({creating_user_reference: "User-65"})
    const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
    const foundProject = /** @type {Project} */ (await Project.preload({creatingUser: true}).find(project.id()))

    expect(foundProject.creatingUser().id()).toEqual(user.id())
  })

  it("preloads polymorphic belongs to relationships", async () => {
    const project = await Project.create({})
    const task = await Task.create({name: "Poly belongs to task", project})
    const projectInteraction = await Interaction.create({kind: "Project interaction", subjectId: project.id(), subjectType: "Project"})
    const taskInteraction = await Interaction.create({kind: "Task interaction", subjectId: task.id(), subjectType: "Task"})
    const interactions = /** @type {Interaction[]} */ (await Interaction.preload({subject: true}).where({id: [projectInteraction.id(), taskInteraction.id()]}).toArray())

    const projectSubject = interactions.find((interaction) => interaction.kind() === "Project interaction")?.subject()
    const taskSubject = interactions.find((interaction) => interaction.kind() === "Task interaction")?.subject()

    expect(projectSubject?.constructor.name).toEqual("Project")
    expect(projectSubject?.id()).toEqual(project.id())
    expect(taskSubject?.constructor.name).toEqual("Task")
    expect(taskSubject?.id()).toEqual(task.id())
  })
})
