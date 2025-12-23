import Dummy from "../../../dummy/index.js"
import Interaction from "../../../dummy/src/models/interaction.js"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"
import User from "../../../dummy/src/models/user.js"

describe("Record - preloader - has one", {focus: true}, () => {
  it("loads with custom primary key and foreign key", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({creating_user_reference: "User-65"})
      const user = await User.create({email: "user@example.com", encrypted_password: "password", reference: "User-65"})
      const foundUser = /** @type {User} */ (await User.preload({createdProject: true}).find(user.id()))

      expect(foundUser.createdProject().id()).toEqual([project.id()])
    })
  })

  it("preloads polymorphic has one relationships", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({})
      const task = await Task.create({name: "Poly has one task", project})

      await Interaction.create({kind: "Project interaction", subjectId: project.id(), subjectType: "Project"})
      const expectedInteraction = await Interaction.create({kind: "Task primary interaction", subjectId: task.id(), subjectType: "Task"})
      const foundTask = /** @type {Task} */ (await Task.preload({primaryInteraction: true}).find(task.id()))
      const loadedInteraction = /** @type {Interaction | undefined} */ (foundTask.getRelationshipByName("primaryInteraction").loaded())

      expect(loadedInteraction?.id()).toEqual(expectedInteraction.id())
      expect(loadedInteraction?.kind()).toEqual(expectedInteraction.kind())
    })
  })
})
