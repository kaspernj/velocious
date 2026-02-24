// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Cli from "../../../src/cli/index.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import SqliteDriver from "../../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"

/**
 * @returns {Configuration} - Configuration for CLI tests.
 */
function createConfiguration() {
  return new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          poolType: SingleMultiUsePool,
          type: "sqlite",
          name: "cli-runner-eval-test",
          migrations: false
        }
      }
    },
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: () => "en",
    localeFallbacks: {},
    locales: ["en"]
  })
}

describe("Cli - Commands - runner", () => {
  it("evaluates inline JavaScript with initialized DB context", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const cli = new Cli({
      configuration: createConfiguration(),
      processArgs: [
        "runner",
        "const rows = await db.query(\"SELECT 9 AS value\"); return {dbType: db.getType(), defaultDbPresent: Boolean(dbs.default), value: rows[0].value}"
      ],
      testing: true
    })
    const result = await cli.execute()

    expect(result.dbType).toEqual("sqlite")
    expect(result.defaultDbPresent).toBeTrue()
    expect(result.value).toEqual(9)
  })

  it("fails with a clear error when no code was provided", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const cli = new Cli({
      configuration: createConfiguration(),
      processArgs: ["runner"],
      testing: true
    })

    await expect(async () => {
      await cli.execute()
    }).toThrow(/Missing code argument/)
  })
})
