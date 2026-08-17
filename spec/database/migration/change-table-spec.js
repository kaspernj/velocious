// @ts-check

import ChangeTable from "../../../src/database/migration/change-table.js"
import ChangeTableFakeDriver from "../../helpers/change-table-fake-driver.js"
import Migration from "../../../src/database/migration/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * Builds a migration wired to a fake driver.
 * @param {object} args - Options.
 * @param {"sqlite" | "mysql" | "pgsql" | "mssql"} args.type - Fake database type.
 * @param {boolean} [args.bulkAlter] - Override whether bulk alter is supported.
 * @param {boolean} [args.bulkAlterIndexes] - Override whether indexes join a bulk alter.
 * @returns {{driver: ChangeTableFakeDriver, migration: Migration}} - The fake driver and migration.
 */
function buildMigration({type, bulkAlter, bulkAlterIndexes}) {
  const driver = new ChangeTableFakeDriver({type, bulkAlter, bulkAlterIndexes})
  const migration = new Migration({configuration: {}, databaseIdentifier: "default", db: driver})

  return {driver, migration}
}

describe("database - migration - changeTable", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("supports the callback-only overload and the options overload", async () => {
    const callbackOnly = buildMigration({type: "sqlite"})

    await callbackOnly.migration.changeTable("tasks", (table) => {
      table.string("title")
    })

    expect(callbackOnly.driver.queries).toEqual(["ALTER TABLE tasks ADD COLUMN title"])

    const optionsOverload = buildMigration({type: "sqlite"})

    await optionsOverload.migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
    })

    expect(optionsOverload.driver.queries).toEqual(["ALTER TABLE tasks ADD COLUMN title"])
  })

  it("executes no queries when the callback throws", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await expect(async () => {
      await migration.changeTable("tasks", {bulk: true}, (table) => {
        table.string("title")
        throw new Error("boom")
      })
    }).toThrow("boom")

    expect(driver.queries).toEqual([])
    expect(driver.alterCalls).toEqual([])
  })

  it("executes recorded commands sequentially when bulk is false", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", (table) => {
      table.string("title")
      table.index(["title"], {name: "index_tasks_on_title"})
      table.remove("legacy_column")
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `title` VARCHAR(255)",
      "CREATE INDEX `index_tasks_on_title` ON `tasks` (`title`)",
      "ALTER TABLE `tasks` DROP COLUMN `legacy_column`"
    ])
  })

  it("falls back to sequential execution on a driver without bulk support", async () => {
    const {driver, migration} = buildMigration({type: "sqlite"})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
      table.index(["title"], {name: "index_tasks_on_title"})
      table.remove("legacy_column")
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE tasks ADD COLUMN title",
      "CREATE INDEX index_tasks_on_title ON tasks (title)",
      "ALTER TABLE tasks DROP COLUMN legacy_column"
    ])
  })

  it("falls back to sequential execution when a bulk-capable type disables the capability", async () => {
    const {driver, migration} = buildMigration({type: "mysql", bulkAlter: false})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
      table.index(["title"], {name: "index_tasks_on_title"})
      table.remove("legacy_column")
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `title` VARCHAR(255)",
      "CREATE INDEX `index_tasks_on_title` ON `tasks` (`title`)",
      "ALTER TABLE `tasks` DROP COLUMN `legacy_column`"
    ])
  })

  it("executes indexes standalone when the driver cannot carry indexes inside a bulk alter", async () => {
    const {driver, migration} = buildMigration({type: "sqlite", bulkAlter: true, bulkAlterIndexes: false})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
      table.index(["title"], {name: "index_tasks_on_title"})
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE tasks ADD COLUMN title",
      "CREATE INDEX index_tasks_on_title ON tasks (title)"
    ])
  })

  it("combines an index-only bulk into one MySQL ALTER with all ADD INDEX clauses", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.index(["title"], {name: "index_tasks_on_title"})
      table.index(["legacy_column"], {name: "index_tasks_on_legacy_column"})
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD INDEX `index_tasks_on_title` (`title`), ADD INDEX `index_tasks_on_legacy_column` (`legacy_column`)"
    ])
    expect(driver.alterCalls).toHaveLength(1)
    expect(driver.alterCalls[0].getColumns()).toHaveLength(0)
    expect(driver.alterCalls[0].getIndexes()).toHaveLength(2)
  })

  it("emits no SQL for an empty callback", async () => {
    const callbackOnly = buildMigration({type: "mysql"})

    await callbackOnly.migration.changeTable("tasks", () => {})

    expect(callbackOnly.driver.queries).toEqual([])

    const optionsOverload = buildMigration({type: "mysql"})

    await optionsOverload.migration.changeTable("tasks", {bulk: true}, () => {})

    expect(optionsOverload.driver.queries).toEqual([])
  })

  it("rejects unknown changeTable options", async () => {
    const {migration} = buildMigration({type: "mysql"})

    await expect(async () => {
      await migration.changeTable("tasks", {bulk: true, ifNotExists: true}, () => {})
    }).toThrow("Unknown arguments: ifNotExists")
  })

  it("combines the bulk example into one MySQL ALTER with all four columns and indexes", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("github_delivery_journal_entries", {bulk: true}, (table) => {
      table.datetime("correlated_at", {null: true})
      table.datetime("first_github_check_created_at", {null: true})
      table.string("first_github_check_run_id", {null: true})
      table.string("first_github_check_url", {null: true})
      table.index(["first_github_check_created_at", "received_at"], {name: "index_github_delivery_journal_on_first_check_received"})
      table.index(["first_github_check_run_id"], {name: "index_github_delivery_journal_on_first_check_run"})
      table.index(["received_at"], {name: "index_github_delivery_journal_on_received"})
      table.index(["commit_sha"], {name: "index_github_delivery_journal_on_commit_sha"})
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `github_delivery_journal_entries` ADD COLUMN `correlated_at` DATETIME(3), ADD COLUMN `first_github_check_created_at` DATETIME(3), ADD COLUMN `first_github_check_run_id` VARCHAR(255), ADD COLUMN `first_github_check_url` VARCHAR(255), ADD INDEX `index_github_delivery_journal_on_first_check_received` (`first_github_check_created_at`, `received_at`), ADD INDEX `index_github_delivery_journal_on_first_check_run` (`first_github_check_run_id`), ADD INDEX `index_github_delivery_journal_on_received` (`received_at`), ADD INDEX `index_github_delivery_journal_on_commit_sha` (`commit_sha`)"
    ])
    expect(driver.alterCalls).toHaveLength(1)
    expect(driver.alterCalls[0].getColumns()).toHaveLength(4)
    expect(driver.alterCalls[0].getIndexes()).toHaveLength(4)
  })

  it("combines columns in one PostgreSQL ALTER but executes indexes separately", async () => {
    const {driver, migration} = buildMigration({type: "pgsql"})

    await migration.changeTable("github_delivery_journal_entries", {bulk: true}, (table) => {
      table.datetime("correlated_at", {null: true})
      table.datetime("first_github_check_created_at", {null: true})
      table.string("first_github_check_run_id", {null: true})
      table.string("first_github_check_url", {null: true})
      table.index(["first_github_check_created_at", "received_at"], {name: "index_github_delivery_journal_on_first_check_received"})
      table.index(["first_github_check_run_id"], {name: "index_github_delivery_journal_on_first_check_run"})
      table.index(["received_at"], {name: "index_github_delivery_journal_on_received"})
      table.index(["commit_sha"], {name: "index_github_delivery_journal_on_commit_sha"})
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE \"github_delivery_journal_entries\" ADD COLUMN \"correlated_at\" TIMESTAMP, ADD COLUMN \"first_github_check_created_at\" TIMESTAMP, ADD COLUMN \"first_github_check_run_id\" VARCHAR(255), ADD COLUMN \"first_github_check_url\" VARCHAR(255)",
      "CREATE INDEX \"index_github_delivery_journal_on_first_check_received\" ON \"github_delivery_journal_entries\" (\"first_github_check_created_at\", \"received_at\")",
      "CREATE INDEX \"index_github_delivery_journal_on_first_check_run\" ON \"github_delivery_journal_entries\" (\"first_github_check_run_id\")",
      "CREATE INDEX \"index_github_delivery_journal_on_received\" ON \"github_delivery_journal_entries\" (\"received_at\")",
      "CREATE INDEX \"index_github_delivery_journal_on_commit_sha\" ON \"github_delivery_journal_entries\" (\"commit_sha\")"
    ])
    expect(driver.alterCalls).toHaveLength(1)
    expect(driver.indexCalls).toHaveLength(4)
  })

  it("flushes the batch before an incompatible command and starts a new batch after", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
      table.string("slug")
      table.removeIndex("index_tasks_legacy")
      table.string("status")
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `title` VARCHAR(255), ADD COLUMN `slug` VARCHAR(255)",
      "DROP INDEX `index_tasks_legacy` ON `tasks`",
      "ALTER TABLE `tasks` ADD COLUMN `status` VARCHAR(255)"
    ])
    expect(driver.alterCalls).toHaveLength(2)
  })

  it("executes down-style removeIndex and remove operations in declaration order", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.removeIndex("index_tasks_on_title")
      table.remove("column_a", "column_b")
    })

    expect(driver.queries).toEqual([
      "DROP INDEX `index_tasks_on_title` ON `tasks`",
      "ALTER TABLE `tasks` DROP COLUMN `column_a`, DROP COLUMN `column_b`"
    ])
  })

  it("keeps the addIndex default name for an unnamed bulk index", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
      table.index(["title"])
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `title` VARCHAR(255), ADD INDEX `index_on_title` (`title`)"
    ])
  })

  it("treats an ifNotExists index as non-combinable", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", {bulk: true}, (table) => {
      table.string("title")
      table.index(["title"], {ifNotExists: true, name: "index_tasks_on_title"})
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `title` VARCHAR(255)",
      "CREATE INDEX IF NOT EXISTS `index_tasks_on_title` ON `tasks` (`title`)"
    ])
  })

  it("records and executes timestamps as created_at and updated_at columns", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", (table) => {
      table.timestamps()
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `created_at` DATETIME(3)",
      "ALTER TABLE `tasks` ADD COLUMN `updated_at` DATETIME(3)"
    ])
  })

  it("records and executes references through the addReference helper", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", (table) => {
      table.references("project")
      table.belongsTo("user")
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` ADD COLUMN `project_id` INTEGER",
      "CREATE INDEX `index_on_project_id` ON `tasks` (`project_id`)",
      "ALTER TABLE `tasks` ADD COLUMN `user_id` INTEGER",
      "CREATE INDEX `index_on_user_id` ON `tasks` (`user_id`)"
    ])
  })

  it("removes both timestamp columns via removeTimestamps", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", (table) => {
      table.removeTimestamps()
    })

    expect(driver.queries).toEqual([
      "ALTER TABLE `tasks` DROP COLUMN `created_at`",
      "ALTER TABLE `tasks` DROP COLUMN `updated_at`"
    ])
  })

  it("drives the removeReference helper via removeReferences", async () => {
    const {driver, migration} = buildMigration({type: "sqlite"})

    driver.setTable("tasks").setColumn("project_id")

    await migration.changeTable("tasks", (table) => {
      table.removeReferences("project")
    })

    expect(driver.queries).toEqual(["ALTER TABLE tasks DROP COLUMN project_id"])
  })

  it("drives the renameColumn helper via rename", async () => {
    const {driver, migration} = buildMigration({type: "mysql"})

    await migration.changeTable("tasks", (table) => {
      table.rename("title", "name")
    })

    expect(driver.queries).toEqual(["ALTER TABLE `tasks` RENAME COLUMN `title` TO `name`"])
  })

  it("drives the changeColumnNull helper via changeNull", async () => {
    const {driver, migration} = buildMigration({type: "sqlite"})

    driver.setTable("tasks").setColumn("title")

    await migration.changeTable("tasks", (table) => {
      table.changeNull("title", false)
    })

    expect(driver.queries).toEqual(["CHANGE NULL tasks.title NULLABLE=false"])
  })

  it("records every facade method onto the operation list synchronously", () => {
    const table = new ChangeTable({tableName: "tasks"})

    table.column("custom_col", "integer", {null: true})
    table.bigint("bigint_col")
    table.blob("blob_col")
    table.boolean("boolean_col")
    table.datetime("datetime_col")
    table.decimal("decimal_col")
    table.integer("integer_col")
    table.json("json_col")
    table.string("string_col")
    table.text("text_col")
    table.tinyint("tinyint_col")
    table.uuid("uuid_col")
    table.timestamps()
    table.index(["string_col"], {name: "index_tasks_on_string_col"})
    table.references("project")
    table.belongsTo("user")
    table.remove("column_a", "column_b")
    table.removeIndex("index_tasks_on_title")
    table.removeReferences("project")
    table.removeTimestamps()
    table.rename("old_name", "new_name")
    table.changeNull("title", true)

    const operationTypes = table.getOperations().map((operation) => operation.type)

    expect(operationTypes).toEqual([
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addColumn",
      "addIndex",
      "addReference",
      "addReference",
      "removeColumn",
      "removeColumn",
      "removeIndex",
      "removeReference",
      "removeColumn",
      "removeColumn",
      "renameColumn",
      "changeColumnNull"
    ])
    expect(table.getTableName()).toEqual("tasks")
  })
})
