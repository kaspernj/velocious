// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import AlterTableBase from "../../../src/database/query/alter-table-base.js"
import TableData from "../../../src/database/table-data/index.js"
import TableForeignKey from "../../../src/database/table-data/table-foreign-key.js"

/**
 * @param {string} databaseType
 * @returns {import("../../../src/database/drivers/base.js").default}
 */
function buildDriver(databaseType) {
  const quoteTableName = databaseType == "pgsql" || databaseType == "mssql"
    ? (/** @type {string} */ name) => `"${name}"`
    : (/** @type {string} */ name) => `\`${name}\``
  const quoteColumnName = quoteTableName
  const quoteIndexName = quoteTableName

  return /** @type {import("../../../src/database/drivers/base.js").default} */ (/** @type {unknown} */ ({
    getType: () => databaseType,
    options: () => ({
      quoteTableName,
      quoteColumnName,
      quoteIndexName,
      quote: (/** @type {string} */ value) => `'${value}'`
    })
  }))
}

/**
 * @param {{columnName: string, name?: string, referencedColumnName: string, referencedTableName: string, tableName: string}} args
 * @returns {TableForeignKey}
 */
function newForeignKey(args) {
  return new TableForeignKey({...args, isNewForeignKey: true})
}

describe("database - query - alter-table foreign-key SQL", () => {
  it("emits ADD CONSTRAINT FOREIGN KEY for new foreign keys on mysql", async () => {
    const tableData = new TableData("github_projects")

    tableData.addForeignKey(newForeignKey({
      columnName: "github_app_installation_id",
      name: "fk_github_projects_github_app_installation",
      referencedColumnName: "id",
      referencedTableName: "github_app_installations",
      tableName: "github_projects"
    }))

    const sqls = await new AlterTableBase({driver: buildDriver("mysql"), tableData}).toSQLs()

    expect(sqls).toEqual([
      "ALTER TABLE `github_projects` ADD CONSTRAINT `fk_github_projects_github_app_installation` FOREIGN KEY (`github_app_installation_id`) REFERENCES `github_app_installations` (`id`)"
    ])
  })

  it("emits ADD FOREIGN KEY without a constraint name when no name is set", async () => {
    const tableData = new TableData("github_projects")

    tableData.addForeignKey(newForeignKey({
      columnName: "github_app_installation_id",
      referencedColumnName: "id",
      referencedTableName: "github_app_installations",
      tableName: "github_projects"
    }))

    const sqls = await new AlterTableBase({driver: buildDriver("mysql"), tableData}).toSQLs()

    expect(sqls).toEqual([
      "ALTER TABLE `github_projects` ADD FOREIGN KEY (`github_app_installation_id`) REFERENCES `github_app_installations` (`id`)"
    ])
  })

  it("uses pgsql identifier quoting for ADD CONSTRAINT on pgsql", async () => {
    const tableData = new TableData("github_projects")

    tableData.addForeignKey(newForeignKey({
      columnName: "github_app_installation_id",
      name: "fk_github_projects_github_app_installation",
      referencedColumnName: "id",
      referencedTableName: "github_app_installations",
      tableName: "github_projects"
    }))

    const sqls = await new AlterTableBase({driver: buildDriver("pgsql"), tableData}).toSQLs()

    expect(sqls).toEqual([
      "ALTER TABLE \"github_projects\" ADD CONSTRAINT \"fk_github_projects_github_app_installation\" FOREIGN KEY (\"github_app_installation_id\") REFERENCES \"github_app_installations\" (\"id\")"
    ])
  })

  it("skips foreign-key emission on sqlite (ALTER TABLE ADD CONSTRAINT is unsupported there)", async () => {
    const tableData = new TableData("github_projects")

    tableData.addForeignKey(newForeignKey({
      columnName: "github_app_installation_id",
      name: "fk_github_projects_github_app_installation",
      referencedColumnName: "id",
      referencedTableName: "github_app_installations",
      tableName: "github_projects"
    }))

    const sqls = await new AlterTableBase({driver: buildDriver("sqlite"), tableData}).toSQLs()

    expect(sqls).toEqual([])
  })

  it("emits column-add and FK-add as a single ALTER TABLE with comma-separated actions", async () => {
    const tableData = new TableData("github_projects")

    tableData.addColumn("github_app_installation_id", {isNewColumn: true, null: true, type: "uuid"})
    tableData.addForeignKey(newForeignKey({
      columnName: "github_app_installation_id",
      name: "fk_github_projects_github_app_installation",
      referencedColumnName: "id",
      referencedTableName: "github_app_installations",
      tableName: "github_projects"
    }))

    const sqls = await new AlterTableBase({driver: buildDriver("mysql"), tableData}).toSQLs()

    expect(sqls.length).toEqual(1)
    expect(sqls[0].startsWith("ALTER TABLE `github_projects` ADD ")).toBe(true)
    expect(sqls[0].includes("github_app_installation_id")).toBe(true)
    expect(sqls[0].includes(", ADD CONSTRAINT `fk_github_projects_github_app_installation` FOREIGN KEY")).toBe(true)
  })

  it("ignores foreign keys that are not marked as new (defensive: pre-existing FKs in the schema mirror)", async () => {
    const tableData = new TableData("github_projects")

    tableData.addForeignKey(new TableForeignKey({
      columnName: "owner_github_user_id",
      name: "github_projects_ibfk_1",
      referencedColumnName: "id",
      referencedTableName: "github_users",
      tableName: "github_projects"
    }))

    const sqls = await new AlterTableBase({driver: buildDriver("mysql"), tableData}).toSQLs()

    expect(sqls).toEqual([])
  })
})
