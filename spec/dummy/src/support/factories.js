import Project from "../models/project.js"
import Task from "../models/task.js"
import User from "../models/user.js"

/**
 * Registers the dummy-app factory definitions used by the factory integration
 * browser specs. This file lives under `src/support` (not `src/models`) so the
 * model auto-loader never treats it as a record class.
 * @param {import("../../../../src/testing/factory/factory-registry.js").default} registry - The registry to define into.
 * @returns {import("../../../../src/testing/factory/factory-registry.js").default} - The same registry, for chaining.
 */
export default function defineDummyFactories(registry) {
  registry.define(({factory, sequence, trait}) => {
    sequence("userEmail", ({value}) => `user${value}@example.com`)
    sequence("projectName", ({value}) => `Project ${value}`)
    sequence("taskName", ({value}) => `Task ${value}`)

    trait("done", ({attribute}) => {
      attribute("isDone", true)
    })

    factory("user", User, ({attribute}) => {
      attribute("email", ({generate}) => generate("userEmail"))
      attribute("encryptedPassword", "test-encrypted-password")
    })

    factory("project", Project, ({after, association, attribute, transient}) => {
      attribute("name", ({generate}) => generate("projectName"))
      transient("tasksCount", 0)
      association("creatingUser", {factory: "user"})

      after("create", async ({context, record}) => {
        await registry.createList("task", context.tasksCount, {project: record})
      })
    })

    factory("task", Task, ({association, attribute}) => {
      attribute("name", ({generate}) => generate("taskName"))
      association("project")
    })

    factory("doneTask", {parent: "task"}, ({attribute}) => {
      attribute("isDone", true)
    })
  })

  return registry
}
