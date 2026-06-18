// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import Migration from "../../../src/database/migration/index.js"
import { describe, expect, it } from "../../../src/testing/test.js"

/** Record backed by a table whose primary key is supplied by callers. */
class ExplicitPrimaryKeyRecord extends DatabaseRecord {
  /** @returns {string} - Table name. */
  static tableName() { return "explicit_primary_key_records" }
}

ExplicitPrimaryKeyRecord.setPrimaryKey("legacy_code")

describe("database - record - explicit primary key create", {tags: ["dummy"]}, () => {
  it("reloads created records by the caller-provided primary key", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const configuration = Configuration.current()
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await driver.dropTable("explicit_primary_key_records", {cascade: true, ifExists: true})
        await migration.createTable("explicit_primary_key_records", {id: false}, (table) => {
          table.string("legacy_code", {null: false, primaryKey: true})
          table.string("label")
        })
        await ExplicitPrimaryKeyRecord.initializeRecord({configuration})

        const record = await ExplicitPrimaryKeyRecord.create({
          legacyCode: "legacy-7301",
          label: "Explicit key"
        })
        const reloaded = await ExplicitPrimaryKeyRecord.find("legacy-7301")

        expect(record.id()).toEqual("legacy-7301")
        expect(record.attributes().legacyCode).toEqual("legacy-7301")
        expect(record.attributes().label).toEqual("Explicit key")
        expect(reloaded.id()).toEqual("legacy-7301")
        expect(reloaded.attributes().label).toEqual("Explicit key")
      } finally {
        delete configuration.getModelClasses().ExplicitPrimaryKeyRecord
        await driver.dropTable("explicit_primary_key_records", {cascade: true, ifExists: true})
      }
    })
  })
})
