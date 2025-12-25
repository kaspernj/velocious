// @ts-check

import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import Project from "../../dummy/src/models/project.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("database - query - pluck", () => {
  it("plucks columns directly without instantiating models", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        await dbs.default.query("INSERT INTO projects (creating_user_reference) VALUES ('alpha'), ('beta')")

        const references = await Project.pluck("creating_user_reference")
        const idsAndReferences = await Project.all().order("id").pluck("id", "creating_user_reference")

        expect(references).toEqual(["alpha", "beta"])
        expect(idsAndReferences.length).toBe(2)
        expect(idsAndReferences[0][1]).toBe("alpha")
        expect(idsAndReferences[1][1]).toBe("beta")
      })
    })
  })

  it("does not underscore provided column names", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        const db = dbs.default

        await db.query("DROP TABLE IF EXISTS camel_case_records")
        await db.query("CREATE TABLE camel_case_records (id INTEGER PRIMARY KEY NOT NULL, CamelCaseColumn VARCHAR(255))")

        class CamelCaseRecord extends DatabaseRecord {}

        CamelCaseRecord.setTableName("camel_case_records")
        await CamelCaseRecord.initializeRecord({configuration: dummyConfiguration})

        try {
          await db.query("INSERT INTO camel_case_records (CamelCaseColumn) VALUES ('alpha'), ('beta')")

          const results = await CamelCaseRecord.pluck("CamelCaseColumn")

          expect(results).toEqual(["alpha", "beta"])
        } finally {
          await db.query("DROP TABLE IF EXISTS camel_case_records")
        }
      })
    })
  })
})
