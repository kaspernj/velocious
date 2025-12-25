// @ts-check

import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import Migration from "../../../src/database/migration/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

class PluckSample extends DatabaseRecord {
  static tableName() { return "pluck_samples" }
}

describe("database - query - pluck", () => {
  it("plucks columns directly without instantiating models", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        const migration = new Migration({
          configuration: dummyConfiguration,
          databaseIdentifier: "default",
          db: dbs.default
        })

        try {
          await migration.createTable("pluck_samples", (t) => {
            t.string("name")
            t.integer("position")
            t.boolean("active")
          })

          await dbs.default.query("INSERT INTO pluck_samples (name, position, active) VALUES ('alpha', 1, 1), ('beta', 2, 0)")

          const names = await PluckSample.pluck("name")
          const idsAndNames = await PluckSample.all().order("position").pluck("id", "name")

          expect(names).toEqual(["alpha", "beta"])
          expect(idsAndNames.length).toBe(2)
          expect(idsAndNames[0][1]).toBe("alpha")
          expect(idsAndNames[1][1]).toBe("beta")
        } finally {
          await migration.dropTable("pluck_samples")
        }
      })
    })
  })
})
