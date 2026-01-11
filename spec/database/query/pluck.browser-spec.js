// @ts-check

import Project from "../../dummy/src/models/project.js"
import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - query - pluck", {tags: ["dummy"]}, () => {
  it("plucks columns directly without instantiating models", async () => {
    await Configuration.current().ensureConnections(async () => {
      await Project.create({creatingUserReference: "alpha"})
      await Project.create({creatingUserReference: "beta"})

      const references = await Project.pluck("creating_user_reference")
      const idsAndReferences = await Project.all().order("id").pluck("id", "creating_user_reference")

      expect(references).toEqual(["alpha", "beta"])
      expect(idsAndReferences.length).toBe(2)
      expect(idsAndReferences[0][1]).toBe("alpha")
      expect(idsAndReferences[1][1]).toBe("beta")
    })
  })
})
