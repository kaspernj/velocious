// @ts-check

import UuidItem from "../../dummy/src/models/uuid-item.js"
import Configuration from "../../../src/configuration.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import Migration from "../../../src/database/migration/index.js"
import {describe, it} from "../../../src/testing/test.js"

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Record backed by a table with an implicit migration primary key. */
class ImplicitUuidItem extends DatabaseRecord {
  /** @returns {string} - Table name. */
  static tableName() { return "implicit_uuid_items" }
}

describe("database - migration - uuid primary key", {tags: ["dummy"]}, () => {
  it("uses UUIDs for implicit primary keys", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const configuration = Configuration.current()
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await driver.dropTable("implicit_uuid_items", {cascade: true, ifExists: true})
        await migration.createTable("implicit_uuid_items", (table) => {
          table.string("title")
        })
        await ImplicitUuidItem.initializeRecord({configuration})

        const record = new ImplicitUuidItem({title: "implicit uuid"})

        await record.save()

        expect(record.id()).toMatch(uuidRegex)
      } finally {
        delete configuration.getModelClasses().ImplicitUuidItem
        await driver.dropTable("implicit_uuid_items", {cascade: true, ifExists: true})
      }
    })
  })

  it("uses UUIDs for implicit reference columns", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const configuration = Configuration.current()
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await driver.dropTable("implicit_uuid_children", {cascade: true, ifExists: true})
        await driver.dropTable("implicit_uuid_parents", {cascade: true, ifExists: true})
        await migration.createTable("implicit_uuid_parents", (table) => {
          table.string("name")
        })
        await migration.createTable("implicit_uuid_children", (table) => {
          table.references("implicit_uuid_parent", {null: true})
        })

        const childTable = await driver.getTableByNameOrFail("implicit_uuid_children")
        const parentReferenceColumn = await childTable.getColumnByNameOrFail("implicit_uuid_parent_id")
        const parentReferenceType = parentReferenceColumn.getType()?.toLowerCase()

        expect(["uuid", "varchar"].includes(parentReferenceType || "")).toEqual(true)
      } finally {
        await driver.dropTable("implicit_uuid_children", {cascade: true, ifExists: true})
        await driver.dropTable("implicit_uuid_parents", {cascade: true, ifExists: true})
      }
    })
  })

  it("uses configured primary key types for implicit primary keys and references", async () => {
    const configuration = Configuration.current()
    const databaseConfiguration = configuration.getDatabaseConfiguration().default
    const originalPrimaryKeyType = databaseConfiguration.primaryKeyType

    databaseConfiguration.primaryKeyType = "bigint"

    try {
      await configuration.ensureConnections(async (dbs) => {
        const driver = dbs.default
        const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

        try {
          await driver.dropTable("configured_primary_key_children", {cascade: true, ifExists: true})
          await driver.dropTable("configured_primary_key_parents", {cascade: true, ifExists: true})
          await migration.createTable("configured_primary_key_parents", (table) => {
            table.string("name")
          })
          await migration.createTable("configured_primary_key_children", (table) => {
            table.references("configured_primary_key_parent", {null: true})
            table.references("configured_primary_key_parent_uuid", {null: true, type: "uuid"})
          })

          const parentTable = await driver.getTableByNameOrFail("configured_primary_key_parents")
          const childTable = await driver.getTableByNameOrFail("configured_primary_key_children")
          const parentIdColumn = await parentTable.getColumnByNameOrFail("id")
          const parentReferenceColumn = await childTable.getColumnByNameOrFail("configured_primary_key_parent_id")
          const explicitUuidReferenceColumn = await childTable.getColumnByNameOrFail("configured_primary_key_parent_uuid_id")
          const expectedParentIdType = driver.getType() == "sqlite" ? "integer" : "bigint"

          expect(parentIdColumn.getType()?.toLowerCase()).toEqual(expectedParentIdType)
          expect(parentReferenceColumn.getType()?.toLowerCase()).toEqual("bigint")
          expect(["uuid", "varchar"].includes(explicitUuidReferenceColumn.getType()?.toLowerCase() || "")).toEqual(true)
        } finally {
          await driver.dropTable("configured_primary_key_children", {cascade: true, ifExists: true})
          await driver.dropTable("configured_primary_key_parents", {cascade: true, ifExists: true})
        }
      })
    } finally {
      if (originalPrimaryKeyType === undefined) {
        delete databaseConfiguration.primaryKeyType
      } else {
        databaseConfiguration.primaryKeyType = originalPrimaryKeyType
      }
    }
  })

  it("keeps reference defaults tied to the database primary key type when table IDs are explicit", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const configuration = Configuration.current()
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      try {
        await driver.dropTable("explicit_id_reference_defaults", {cascade: true, ifExists: true})
        await migration.createTable("explicit_id_reference_defaults", {id: {type: "bigint"}}, (table) => {
          table.references("implicit_uuid_parent", {null: true})
        })

        const table = await driver.getTableByNameOrFail("explicit_id_reference_defaults")
        const referenceColumn = await table.getColumnByNameOrFail("implicit_uuid_parent_id")

        expect(["uuid", "varchar"].includes(referenceColumn.getType()?.toLowerCase() || "")).toEqual(true)
      } finally {
        await driver.dropTable("explicit_id_reference_defaults", {cascade: true, ifExists: true})
      }
    })
  })

  it("uses the explicit migration driver for primary key defaults outside a pool checkout", async () => {
    const configuration = Configuration.current()
    const pool = configuration.getDatabasePool("default")
    const outsideContextConnection = pool.withoutCurrentConnectionContext(() => pool.getCurrentContextConnection())
    const outsideContextConnectionIsShared = Boolean(outsideContextConnection && outsideContextConnection.getArgs().getConnection)

    if (outsideContextConnection && !outsideContextConnectionIsShared) await pool.closeAll()
    const driver = await pool.spawnConnection()
    const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
    const sharesConnection = Boolean(driver.getArgs().getConnection)

    try {
      await driver.dropTable("explicit_driver_primary_keys", {cascade: true, ifExists: true})
      await configuration.withoutCurrentConnectionContexts(async () => {
        await migration.createTable("explicit_driver_primary_keys", {id: {type: "bigint"}}, (table) => {
          table.string("name")
        })
      })

      const table = await driver.getTableByNameOrFail("explicit_driver_primary_keys")
      const idColumn = await table.getColumnByNameOrFail("id")
      const expectedIdType = driver.getType() == "sqlite" ? "integer" : "bigint"

      expect(idColumn.getType()?.toLowerCase()).toEqual(expectedIdType)
    } finally {
      await driver.dropTable("explicit_driver_primary_keys", {cascade: true, ifExists: true})

      if (!sharesConnection) await driver.close()
    }
  })

  it("uses driver default UUIDs when supported", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const table = await dbs.default.getTableByNameOrFail("uuid_items")
      const idColumn = await table.getColumnByNameOrFail("id")
      const record = new UuidItem({title: "driver default uuid"})

      await record.save()

      const columnDefault = idColumn.getDefault()
      const supportsDefaultUUID = typeof dbs.default.supportsDefaultPrimaryKeyUUID == "function" && dbs.default.supportsDefaultPrimaryKeyUUID()
      const defaultString = typeof columnDefault == "string" ? columnDefault.toLowerCase() : ""

      if (dbs.default.getType() != "sqlite") {
        expect(idColumn.getAutoIncrement()).toBeFalse()
      }
      if (supportsDefaultUUID) {
        expect(defaultString).toMatch(/newid|gen_random_uuid|uuid/i)
      } else {
        expect(defaultString).toEqual("")
      }
      expect(record.id()).toMatch(uuidRegex)
    })
  })

  it("assigns UUIDs in the record when the driver cannot default it", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const driver = dbs.default
      const originalSupportsDefault = driver.supportsDefaultPrimaryKeyUUID
      const record = new UuidItem({title: "manual uuid assignment"})

      driver.supportsDefaultPrimaryKeyUUID = () => false

      try {
        await record.save()

        expect(record.id()).toMatch(uuidRegex)
        expect(record.attributes().id).toEqual(record.id())
        const reloaded = await UuidItem.find(record.id())

        expect(reloaded.id()).toEqual(record.id())
      } finally {
        driver.supportsDefaultPrimaryKeyUUID = originalSupportsDefault
      }
    })
  })
})
