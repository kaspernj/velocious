// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import CreateTableBase from "../../../src/database/query/create-table-base.js"
import TableData from "../../../src/database/table-data/index.js"
import TableForeignKey from "../../../src/database/table-data/table-foreign-key.js"

/**
 * @param {string} databaseType - Database type identifier.
 * @returns {import("../../../src/database/drivers/base.js").default} - Stub driver.
 */
function buildDriver(databaseType) {
  const quote = (/** @type {string} */ value) => `'${value}'`
  const quoteTableName = (/** @type {string} */ name) => `\`${name}\``
  const quoteColumnName = quoteTableName
  const quoteIndexName = quoteTableName
  const options = {
    quote,
    quoteColumnName,
    quoteIndexName,
    quoteTableName
  }

  return /** @type {import("../../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    getType: () => databaseType,
    options: () => options,
    quoteColumn: quoteColumnName,
    shouldSetAutoIncrementWhenPrimaryKey: () => false
  }))
}

describe("database - query - create-table foreign-key SQL", () => {
  it("emits a named CONSTRAINT FOREIGN KEY clause when the table has a named foreign key", async () => {
    const tableData = new TableData("posts")

    tableData.addColumn("id", {type: "integer", primaryKey: true, null: false})
    tableData.addColumn("author_id", {type: "integer", null: true})
    tableData.addForeignKey(new TableForeignKey({
      columnName: "author_id",
      name: "fk_posts_authors",
      referencedColumnName: "id",
      referencedTableName: "authors",
      tableName: "posts"
    }))

    const sqls = await new CreateTableBase({driver: buildDriver("sqlite"), tableData}).toSql()

    expect(sqls.length).toEqual(1)
    expect(sqls[0]).toContain("CONSTRAINT `fk_posts_authors` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`)")
  })

  it("does not double-emit REFERENCES inline on the column when a table-level FK exists for it", async () => {
    const tableData = new TableData("posts")

    tableData.addColumn("id", {type: "integer", primaryKey: true, null: false})
    tableData.addColumn("author_id", {foreignKey: true, type: "integer", null: true})
    tableData.addForeignKey(new TableForeignKey({
      columnName: "author_id",
      name: "fk_posts_authors",
      referencedColumnName: "id",
      referencedTableName: "authors",
      tableName: "posts"
    }))

    const sqls = await new CreateTableBase({driver: buildDriver("sqlite"), tableData}).toSql()
    const referencesCount = sqls[0].match(/REFERENCES `authors`/g)?.length || 0

    // The inline REFERENCES (no CONSTRAINT name) must not appear; only the named table-level
    // clause should reference `authors`.
    expect(referencesCount).toEqual(1)
    expect(sqls[0]).toContain("CONSTRAINT `fk_posts_authors`")
  })

  it("still emits inline REFERENCES for the foreignKey: true shorthand without a table-level FK", async () => {
    const tableData = new TableData("posts")

    tableData.addColumn("id", {type: "integer", primaryKey: true, null: false})
    tableData.addColumn("author_id", {foreignKey: true, type: "integer", null: true})

    const sqls = await new CreateTableBase({driver: buildDriver("sqlite"), tableData}).toSql()

    expect(sqls[0]).toContain("`author_id` INTEGER")
    expect(sqls[0]).toContain("REFERENCES `authors`(`id`)")
    expect(sqls[0]).not.toContain("CONSTRAINT")
  })
})
