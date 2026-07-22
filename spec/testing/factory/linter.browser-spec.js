import {beforeEach, describe, expect, it} from "../../../src/testing/test.js"
import {createFactoryRegistry} from "../../../src/testing/factory/index.js"
import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"

describe("Factory - lint", {tags: ["dummy"]}, () => {
  /** @type {import("../../../src/testing/factory/factory-registry.js").default} */
  let registry

  beforeEach(() => {
    registry = createFactoryRegistry()
  })

  it("passes valid factories and rolls back the created rows", async () => {
    registry.define(({factory}) => {
      factory("project", Project, ({attribute}) => attribute("name", "Lint project"))
    })

    await registry.lint({factories: ["project"]})

    expect(await Project.count()).toEqual(0)
  })

  it("aggregates failures for invalid factories and leaves no rows", async () => {
    registry.define(({factory}) => {
      factory("badTask", Task, ({attribute}) => attribute("name", "Bad task"))
    })

    await expect(async () => await registry.lint({factories: ["badTask"]})).toThrow(/lint found 1 error/)
    expect(await Task.count()).toEqual(0)
  })
})
