// @ts-check

import Configuration from "../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("MysqlDriver#execStructureScript", () => {
  it("returns false without connecting when multipleStatements is not enabled", async () => {
    const driver = new MysqlDriver({multipleStatements: false}, buildConfiguration())

    expect(await driver.execStructureScript("CREATE TABLE a (id INT);")).toEqual(false)
  })

  it("refuses to batch a write dump on a read-only connection, same as the per-statement path", async () => {
    const driver = new MysqlDriver({multipleStatements: true, readOnly: true}, buildConfiguration())

    /** @type {unknown} */
    let rejected

    try {
      await driver.execStructureScript("CREATE TABLE a (id INT);")
    } catch (error) {
      rejected = error
    }

    expect(rejected instanceof Error).toEqual(true)
    expect(/** @type {Error} */ (rejected).message).toEqual("Database is read-only")
  })
})
