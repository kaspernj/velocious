// @ts-check

import Configuration from "../../../src/configuration.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - removeReference", {tags: ["dummy"]}, () => {
  it("removes a reference column, its ordinary index, and its foreign key", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const parentTableName = "remove_reference_members"
      const childTableName = "remove_reference_enrollments"
      const referenceName = "removeReferenceMember"
      const referenceColumnName = "remove_reference_member_id"

      try {
        await dropRemoveReferenceTables(driver, childTableName, parentTableName)
        await migration.createTable(parentTableName, {id: {type: "uuid"}})
        await migration.createTable(childTableName, {id: {type: "uuid"}}, (table) => {
          table.string("status", {null: false})
          table.string("category", {null: false})
        })
        await migration.addIndex(childTableName, ["status", "category"], {name: "index_remove_reference_enrollments_on_status_and_category"})
        await migration.addReference(childTableName, referenceName, {foreignKey: true, type: "uuid"})

        const tableWithReference = await driver.getTableByNameOrFail(childTableName)
        const columnNames = (await tableWithReference.getColumns()).map((column) => column.getName())
        const memberIndexes = (await tableWithReference.getIndexes())
          .filter((index) => index.getColumnNames().length === 1 && index.getColumnNames()[0] === referenceColumnName)
        const foreignKeys = await tableWithReference.getForeignKeys()

        expect(columnNames).toContain(referenceColumnName)
        expect(memberIndexes).toHaveLength(1)
        expect(memberIndexes[0].isUnique()).toBe(false)
        expect(foreignKeys.map((foreignKey) => foreignKey.getColumnName())).toContain(referenceColumnName)

        await migration.removeReference(childTableName, referenceName)

        const tableWithoutReference = await driver.getTableByNameOrFail(childTableName)
        const remainingColumnNames = (await tableWithoutReference.getColumns()).map((column) => column.getName())
        const remainingMemberIndexes = (await tableWithoutReference.getIndexes())
          .filter((index) => index.getColumnNames().length === 1 && index.getColumnNames()[0] === referenceColumnName)
        const remainingForeignKeys = await tableWithoutReference.getForeignKeys()
        const remainingCompositeIndex = (await tableWithoutReference.getIndexes())
          .find((index) => index.getName() === "index_remove_reference_enrollments_on_status_and_category")

        expect(remainingColumnNames).not.toContain(referenceColumnName)
        expect(remainingMemberIndexes).toHaveLength(0)
        expect(remainingForeignKeys.map((foreignKey) => foreignKey.getColumnName())).not.toContain(referenceColumnName)
        expect(remainingCompositeIndex?.getColumnNames()).toEqual(["status", "category"])
      } finally {
        await dropRemoveReferenceTables(driver, childTableName, parentTableName)
      }
    })
  })

  it("removes a reference column and its ordinary index when no foreign key was added", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const childTableName = "remove_reference_drafts"

      try {
        await dropRemoveReferenceTables(driver, childTableName)
        await migration.createTable(childTableName, {id: {type: "uuid"}})
        await migration.addReference(childTableName, "member", {type: "uuid"})

        const tableWithReference = await driver.getTableByNameOrFail(childTableName)
        const memberIndexes = (await tableWithReference.getIndexes())
          .filter((index) => index.getColumnNames().length === 1 && index.getColumnNames()[0] === "member_id")

        expect((await tableWithReference.getColumns()).map((column) => column.getName())).toContain("member_id")
        expect(memberIndexes).toHaveLength(1)
        expect(memberIndexes[0].isUnique()).toBe(false)

        await migration.removeReference(childTableName, "member")

        const tableWithoutReference = await driver.getTableByNameOrFail(childTableName)
        const remainingMemberIndexes = (await tableWithoutReference.getIndexes())
          .filter((index) => index.getColumnNames().length === 1 && index.getColumnNames()[0] === "member_id")

        expect((await tableWithoutReference.getColumns()).map((column) => column.getName())).not.toContain("member_id")
        expect(remainingMemberIndexes).toHaveLength(0)
      } finally {
        await dropRemoveReferenceTables(driver, childTableName)
      }
    })
  })

  it("removes a reference column and its unique index when no foreign key was added", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const childTableName = "remove_reference_unique_drafts"

      try {
        await dropRemoveReferenceTables(driver, childTableName)
        await migration.createTable(childTableName, {id: {type: "uuid"}})
        await migration.addReference(childTableName, "member", {type: "uuid", unique: true})

        const tableWithReference = await driver.getTableByNameOrFail(childTableName)
        const memberIndexes = (await tableWithReference.getIndexes())
          .filter((index) => index.getColumnNames().length === 1 && index.getColumnNames()[0] === "member_id")

        expect((await tableWithReference.getColumns()).map((column) => column.getName())).toContain("member_id")
        expect(memberIndexes).toHaveLength(1)
        expect(memberIndexes[0].isUnique()).toBe(true)

        await migration.removeReference(childTableName, "member")

        const tableWithoutReference = await driver.getTableByNameOrFail(childTableName)
        const remainingMemberIndexes = (await tableWithoutReference.getIndexes())
          .filter((index) => index.getColumnNames().length === 1 && index.getColumnNames()[0] === "member_id")

        expect((await tableWithoutReference.getColumns()).map((column) => column.getName())).not.toContain("member_id")
        expect(remainingMemberIndexes).toHaveLength(0)
      } finally {
        await dropRemoveReferenceTables(driver, childTableName)
      }
    })
  })
})

/**
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @param {string} childTableName - Child table name.
 * @param {string | undefined} [parentTableName] - Parent table name.
 * @returns {Promise<void>}
 */
async function dropRemoveReferenceTables(driver, childTableName, parentTableName) {
  await driver.dropTable(`${childTableName}_velocious_rebuild`, {cascade: true, ifExists: true})
  await driver.dropTable(childTableName, {cascade: true, ifExists: true})
  if (parentTableName) await driver.dropTable(parentTableName, {cascade: true, ifExists: true})
}
