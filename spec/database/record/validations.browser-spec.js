import PresenceValidator from "../../../src/database/record/validators/presence.js"
import Task from "../../dummy/src/models/task.js"
import User from "../../dummy/src/models/user.js"
import {ValidationError} from "../../../src/database/record/index.js"
import Project from "../../dummy/src/models/project.js"

describe("Record - validations", {tags: ["dummy"]}, () => {
  it("raises validations if trying to create an invalid record because of a presence validation", async () => {
    const project = await Project.create()
    const task = new Task({name: " ", project})

    await expect(async () => task.save()).toThrowError(new ValidationError("Name can't be blank"))
  })

  it("raises validations if trying to create an invalid record with a blank value because of a presence validation", async () => {
    const project = await Project.create()
    const task = new Task({name: null, project})

    await expect(async () => task.save()).toThrowError(new ValidationError("Name can't be blank"))
  })

  it("fails presence validation for null and undefined values", async () => {
    const project = await Project.create()

    for (const [index, value] of [null, undefined].entries()) {
      const task = await Task.create({name: `Task ${index}`, project})
      const validator = new PresenceValidator({attributeName: "name", args: {}})

      task.assign({name: value})
      await validator.validate({model: task, attributeName: "name"})

      expect(task._validationErrors.name?.map((error) => error.type)).toEqual(["presence"])
    }
  })

  it("fails presence validation for blank and whitespace-only strings", async () => {
    const project = await Project.create()

    for (const [index, value] of ["", "   "].entries()) {
      const task = await Task.create({name: `Task ${index}`, project})
      const validator = new PresenceValidator({attributeName: "name", args: {}})

      task.assign({name: value})
      await validator.validate({model: task, attributeName: "name"})

      expect(task._validationErrors.name?.map((error) => error.type)).toEqual(["presence"])
    }
  })

  it("passes presence validation for a non-empty string", async () => {
    const project = await Project.create()
    const task = new Task({name: "Task", project})
    const validator = new PresenceValidator({attributeName: "name", args: {}})

    await validator.validate({model: task, attributeName: "name"})

    expect(task._validationErrors.name).toBeUndefined()
  })

  it("passes presence validation for a Date value", async () => {
    const project = await Project.create()
    const task = new Task({createdAt: new Date("2026-08-25T10:00:00Z"), name: "Task", project})
    const validator = new PresenceValidator({attributeName: "createdAt", args: {}})

    await validator.validate({model: task, attributeName: "createdAt"})

    expect(task._validationErrors.createdAt).toBeUndefined()
  })

  it("passes presence validation for truthy non-string values", async () => {
    const project = await Project.create()
    const task = new Task({name: "Task", project})
    const validator = new PresenceValidator({attributeName: "isDone", args: {}})

    task.assign({isDone: true})
    await validator.validate({model: task, attributeName: "isDone"})

    expect(task._validationErrors.isDone).toBeUndefined()
  })

  it("raises validations if trying to create an invalid record because of a uniqueness validation", async () => {
    const project = await Project.create()
    await Task.create({name: "Task 1", project})

    const task2 = await Task.create({name: "Task 2", project})

    try {
      await task2.update({name: "Task 1"})

      throw new Error("Task 2 save didn't fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.message).toEqual("Name has already been taken")
    }
  })

  it("allows the same name on different projects when uniqueness is scoped to projectId", async () => {
    const projectA = await Project.create()
    const projectB = await Project.create()

    await Task.create({name: "Shared Name", project: projectA})
    const taskOnB = await Task.create({name: "Shared Name", project: projectB})

    expect(taskOnB.id()).toBeDefined()
  })

  it("rejects the same name on the same project when uniqueness is scoped to projectId", async () => {
    const project = await Project.create()
    await Task.create({name: "Duplicate", project})

    try {
      await Task.create({name: "Duplicate", project})

      throw new Error("Duplicate task on same project didn't fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.message).toEqual("Name has already been taken")
    }
  })

  it("rejects a malformed email with a format validation", async () => {
    const user = new User({email: "not-an-email", encryptedPassword: "test"})

    await expect(async () => user.save()).toThrowError(new ValidationError("Email is invalid"))
  })

  it("allows a valid email with a format validation", async () => {
    const user = await User.create({email: "valid@example.com", encryptedPassword: "test"})

    expect(user.email()).toEqual("valid@example.com")
  })

  it("allows a blank email when format validation has allowBlank", async () => {
    const user = await User.create({email: "", encryptedPassword: "test"})

    expect(user.id()).toBeDefined()
  })
})
