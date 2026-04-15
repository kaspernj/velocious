// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import CreateDatabase from "../../../../../src/database/drivers/mysql/sql/create-database.js"
import MysqlDriver from "../../../../../src/database/drivers/mysql/index.js"

/**
 * Build a bare-bones mysql driver instance for toSql() tests. We never
 * connect — we just need the Options wiring that the base query uses for
 * quoting.
 *
 * @returns {MysqlDriver}
 */
function buildDriver() {
  return new MysqlDriver({type: "mysql"})
}

describe("database/drivers/mysql/sql/create-database", () => {
  it("emits CREATE DATABASE IF NOT EXISTS without charset or collation by default", () => {
    const driver = buildDriver()
    const createDatabase = new CreateDatabase({databaseName: "awesome_tasks_test", driver, ifNotExists: true})

    expect(createDatabase.toSql()).toEqual(["CREATE DATABASE IF NOT EXISTS `awesome_tasks_test`"])
  })

  it("emits CHARACTER SET when charset is provided", () => {
    const driver = buildDriver()
    const createDatabase = new CreateDatabase({
      charset: "utf8mb4",
      databaseName: "awesome_tasks_test",
      driver,
      ifNotExists: true
    })

    expect(createDatabase.toSql()).toEqual([
      "CREATE DATABASE IF NOT EXISTS `awesome_tasks_test` CHARACTER SET utf8mb4"
    ])
  })

  it("emits COLLATE when collation is provided", () => {
    const driver = buildDriver()
    const createDatabase = new CreateDatabase({
      collation: "utf8mb4_unicode_ci",
      databaseName: "awesome_tasks_test",
      driver,
      ifNotExists: true
    })

    expect(createDatabase.toSql()).toEqual([
      "CREATE DATABASE IF NOT EXISTS `awesome_tasks_test` COLLATE utf8mb4_unicode_ci"
    ])
  })

  it("emits both CHARACTER SET and COLLATE when both are provided", () => {
    const driver = buildDriver()
    const createDatabase = new CreateDatabase({
      charset: "utf8mb4",
      collation: "utf8mb4_unicode_ci",
      databaseName: "awesome_tasks_test",
      driver,
      ifNotExists: true
    })

    expect(createDatabase.toSql()).toEqual([
      "CREATE DATABASE IF NOT EXISTS `awesome_tasks_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    ])
  })

  it("rejects charset values that don't match [A-Za-z0-9_]+", () => {
    const driver = buildDriver()
    const createDatabase = new CreateDatabase({
      charset: "utf8mb4; DROP TABLE users",
      databaseName: "awesome_tasks_test",
      driver,
      ifNotExists: true
    })

    let thrown

    try {
      createDatabase.toSql()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(thrown.message).toContain("Invalid charset value")
  })

  it("rejects collation values that don't match [A-Za-z0-9_]+", () => {
    const driver = buildDriver()
    const createDatabase = new CreateDatabase({
      collation: "utf8mb4_unicode_ci; DROP TABLE users",
      databaseName: "awesome_tasks_test",
      driver,
      ifNotExists: true
    })

    let thrown

    try {
      createDatabase.toSql()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(thrown.message).toContain("Invalid collation value")
  })
})
