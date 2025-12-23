// @ts-check

import Dummy from "../../dummy/index.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import {describe, it} from "../../../src/testing/test.js"

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe("database - migration - uuid primary key", () => {
  it("uses driver default UUIDs when supported", {focus: true}, async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
        const table = await dbs.default.getTableByNameOrFail("uuid_items")
        const idColumn = await table.getColumnByNameOrFail("id")
        const record = new UuidItem({title: "driver default uuid"})

        await record.save()

        const columnDefault = idColumn.getDefault()
        const supportsDefaultUUID = typeof dbs.default.supportsDefaultPrimaryKeyUUID == "function" && dbs.default.supportsDefaultPrimaryKeyUUID()
        const defaultString = typeof columnDefault == "string" ? columnDefault.toLowerCase() : ""

        expect(idColumn.getAutoIncrement()).toBeFalse()
        if (supportsDefaultUUID) {
          expect(defaultString).toMatch(/newid|gen_random_uuid|uuid/i)
        } else {
          expect(defaultString).toEqual("")
        }
        expect(record.id()).toMatch(uuidRegex)
      })
    })
  })

  it("assigns UUIDs in the record when the driver cannot default it", async () => {
    await Dummy.run(async () => {
      await dummyConfiguration.ensureConnections(async (dbs) => {
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
})
