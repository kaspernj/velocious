// @ts-check

import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration", () => {
  it("checks if a column exists", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        const migration = new Migration({
          configuration: dummyConfiguration,
          databaseIdentifier: "default",
          db: dbs.default
        })

        const projectsIDExists = await migration.columnExists("projects", "id")

        expect(projectsIDExists).toBe(true)

        const projectsSomeNonExistingColumnExists = await migration.columnExists("projects", "some_non_existing_column")

        expect(projectsSomeNonExistingColumnExists).toBe(false)
      })
    })
  })
})
