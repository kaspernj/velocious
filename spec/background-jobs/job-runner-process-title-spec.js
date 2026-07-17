// @ts-check

import fs from "fs/promises"
import path from "path"
import {fileURLToPath, pathToFileURL} from "url"

import Configuration, {CurrentConfigurationNotSetError} from "../../src/configuration.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import runJobPayload from "../../src/background-jobs/job-runner.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {string} - Repository root. */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

/** @returns {Promise<{cleanup: () => Promise<void>, directory: string}>} - Temporary project. */
async function createTempProjectDir() {
  const directory = path.join(repoRoot(), "tmp", `job-runner-title-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

  return {
    cleanup: async () => {
      await fs.rm(directory, {recursive: true, force: true})
    },
    directory
  }
}

/**
 * Writes a job whose `perform` records the process title it observed while running.
 * @param {string} directory - Temporary project directory.
 * @param {object} args - Options.
 * @param {string} args.className - Job class name.
 * @param {string} args.fileName - Job file name.
 * @param {string} [args.processTitle] - Optional static processTitle to declare.
 * @returns {Promise<void>}
 */
async function writeTitleJob(directory, {className, fileName, processTitle}) {
  const jobPath = pathToFileURL(path.join(repoRoot(), "src", "background-jobs", "job.js")).href
  const staticLine = processTitle ? `  static processTitle = ${JSON.stringify(processTitle)}\n` : ""
  const contents = `import fs from "fs/promises"
import VelociousJob from ${JSON.stringify(jobPath)}

export default class ${className} extends VelociousJob {
${staticLine}  async perform(outputPath) {
    await fs.writeFile(outputPath, process.title)
  }
}
`

  await fs.writeFile(path.join(directory, "src", "jobs", fileName), contents)
}

/**
 * @param {object} args - Options.
 * @param {string} args.directory - App directory.
 * @param {string} args.name - Database name.
 * @returns {Configuration}
 */
function createConfiguration({directory, name}) {
  return new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          poolType: SingleMultiUsePool,
          type: "sqlite",
          name,
          migrations: false
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("Background jobs - runner process title", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("uses the job's static processTitle while running and restores the base title after", async () => {
    const {cleanup, directory} = await createTempProjectDir()
    await writeTitleJob(directory, {className: "CustomTitleJob", fileName: "custom-title-job.js", processTitle: "velocious custom title"})
    await writeTitleJob(directory, {className: "FallbackTitleJob", fileName: "fallback-title-job.js"})

    /** @type {Configuration | undefined} */
    let previousConfiguration

    try {
      previousConfiguration = Configuration.current()
    } catch (error) {
      if (!(error instanceof CurrentConfigurationNotSetError)) throw error
    }

    const configuration = createConfiguration({directory, name: "job-runner-title"})
    const baseTitle = process.title
    const customOut = path.join(directory, "custom.txt")
    const fallbackOut = path.join(directory, "fallback.txt")

    try {
      configuration.setCurrent()

      await runJobPayload({jobName: "CustomTitleJob", args: [customOut]}, {closeConnections: false})
      // The declared static processTitle is what the process reports while the job runs...
      expect(await fs.readFile(customOut, "utf8")).toEqual("velocious custom title")
      // ...and the base title is restored once it finishes.
      expect(process.title).toEqual(baseTitle)

      await runJobPayload({jobName: "FallbackTitleJob", args: [fallbackOut]}, {closeConnections: false})
      // A job without a declared title falls back to its name.
      expect(await fs.readFile(fallbackOut, "utf8")).toEqual("velocious job-runner: FallbackTitleJob")
      expect(process.title).toEqual(baseTitle)
    } finally {
      previousConfiguration?.setCurrent()
      await configuration.disconnectBeacon()
      await configuration.closeDatabaseConnections()
      await cleanup()
    }
  })
})
