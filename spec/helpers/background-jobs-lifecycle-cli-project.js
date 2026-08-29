// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Creates an isolated application for lifecycle CLI process tests.
 * @returns {Promise<{cleanup: () => Promise<void>, directory: string}>} - Fixture helpers.
 */
export default async function createBackgroundJobsLifecycleCliProject() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-background-jobs-lifecycle-cli-"))
  const configurationPath = path.join(directory, "src", "config", "configuration.js")
  const configurationImportPath = new URL("../../src/configuration.js", import.meta.url).href
  const environmentHandlerImportPath = new URL("../../src/environment-handlers/node.js", import.meta.url).href
  const poolImportPath = new URL("../../src/database/pool/single-multi-use.js", import.meta.url).href
  const sqliteDriverImportPath = new URL("../../src/database/drivers/sqlite/index.js", import.meta.url).href

  await fs.mkdir(path.dirname(configurationPath), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
  await fs.writeFile(configurationPath, `
import Configuration from ${JSON.stringify(configurationImportPath)}
import NodeEnvironmentHandler from ${JSON.stringify(environmentHandlerImportPath)}
import SingleMultiUsePool from ${JSON.stringify(poolImportPath)}
import SqliteDriver from ${JSON.stringify(sqliteDriverImportPath)}

export default new Configuration({
  autoload: false,
  database: {
    test: {
      default: {
        driver: SqliteDriver,
        migrations: false,
        name: "lifecycle-cli",
        poolType: SingleMultiUsePool,
        type: "sqlite"
      }
    }
  },
  directory: ${JSON.stringify(directory)},
  environment: "test",
  environmentHandler: new NodeEnvironmentHandler(),
  initializeModels: async () => {},
  locale: () => "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})
`)

  return {
    cleanup: async () => await fs.rm(directory, {force: true, recursive: true}),
    directory
  }
}
