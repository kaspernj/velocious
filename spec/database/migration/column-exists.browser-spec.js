// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration", {tags: ["dummy"]}, () => {
  it("checks if a column exists", async () => {
    const configuration = Configuration.current()
    await configuration.ensureConnections(async (dbs) => {
      const migration = new Migration({
        configuration,
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
