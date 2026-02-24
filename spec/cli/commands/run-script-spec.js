// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Cli from "../../../src/cli/index.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import SqliteDriver from "../../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"
import fs from "fs/promises"
import os from "os"
import path from "node:path"

/**
 * @returns {Promise<{directory: string, cleanup: () => Promise<void>}>} - Temp project directory helpers.
 */
async function createTempProjectDir() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-run-script-"))

  await fs.mkdir(path.join(directory, "scripts"), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

  return {
    directory,
    cleanup: async () => {
      await fs.rm(directory, {recursive: true, force: true})
    }
  }
}

/**
 * @param {string} directory - Project directory.
 * @returns {Configuration} - Configuration for CLI tests.
 */
function createConfiguration(directory) {
  return new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          poolType: SingleMultiUsePool,
          type: "sqlite",
          name: "cli-run-script-test",
          migrations: false
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: () => "en",
    localeFallbacks: {},
    locales: ["en"]
  })
}

describe("Cli - Commands - run-script", () => {
  it("imports the provided file path and runs its default function with initialized DB context", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      await fs.writeFile(path.join(directory, "scripts", "custom-run-script.js"), `export default async function customRunScript({args, db, dbs}) {
  const rows = await db.query("SELECT 7 AS value")

  return {
    args,
    dbType: db.getType(),
    defaultDbPresent: Boolean(dbs.default),
    value: rows[0].value
  }
}
`)

      const cli = new Cli({
        configuration: createConfiguration(directory),
        processArgs: ["run-script", "scripts/custom-run-script.js", "hello", "world"],
        testing: true
      })
      const result = await cli.execute()

      expect(result.dbType).toEqual("sqlite")
      expect(result.defaultDbPresent).toBeTrue()
      expect(result.value).toEqual(7)
      expect(result.args).toEqual(["hello", "world"])
    } finally {
      await cleanup()
    }
  })

  it("fails with a clear error when no file path was provided", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const cli = new Cli({
        configuration: createConfiguration(directory),
        processArgs: ["run-script"],
        testing: true
      })

      await expect(async () => {
        await cli.execute()
      }).toThrow(/Missing file path argument/)
    } finally {
      await cleanup()
    }
  })
})
