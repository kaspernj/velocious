// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import repoRoot from "./repo-root.js"

/**
 * @typedef {object} ApplicationProcessLifecycleEvent
 * @property {string} instanceId - Opaque lifecycle identity.
 * @property {"start" | "teardown"} phase - Initializer phase.
 * @property {string} type - Generic process type.
 */

/**
 * Writes a generic temporary application that records initializer lifecycle events.
 * @param {object} [args] - Project options.
 * @param {number} [args.backgroundJobsPort] - Fake status-server port for runner jobs.
 * @returns {Promise<{cleanup: () => Promise<void>, directory: string, eventsPath: string, readEvents: () => Promise<ApplicationProcessLifecycleEvent[]>}>} - Temporary project.
 */
export async function createApplicationProcessLifecycleProject({backgroundJobsPort} = {}) {
  const tmpRoot = path.join(repoRoot(), "tmp")
  await fs.mkdir(tmpRoot, {recursive: true})
  const directory = await fs.mkdtemp(path.join(tmpRoot, "application-process-project-"))
  const configDirectory = path.join(directory, "src", "config")
  const initializersDirectory = path.join(directory, "src", "initializers")
  const jobsDirectory = path.join(directory, "src", "jobs")
  const eventsPath = path.join(directory, "application-process-events.jsonl")
  const configurationPath = pathToFileURL(path.join(repoRoot(), "src", "configuration.js")).href
  const environmentHandlerPath = pathToFileURL(path.join(repoRoot(), "src", "environment-handlers", "node.js")).href
  const initializerPath = pathToFileURL(path.join(repoRoot(), "src", "initializer.js")).href
  const jobPath = pathToFileURL(path.join(repoRoot(), "src", "background-jobs", "job.js")).href
  const routesPath = pathToFileURL(path.join(repoRoot(), "src", "routes", "index.js")).href
  const sqliteDriverPath = pathToFileURL(path.join(repoRoot(), "src", "database", "drivers", "sqlite", "index.js")).href
  const singlePoolPath = pathToFileURL(path.join(repoRoot(), "src", "database", "pool", "single-multi-use.js")).href

  await fs.mkdir(configDirectory, {recursive: true})
  await fs.mkdir(initializersDirectory, {recursive: true})
  await fs.mkdir(jobsDirectory, {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
  await fs.writeFile(path.join(configDirectory, "routes.js"), `import Routes from ${JSON.stringify(routesPath)}

export default {routes: new Routes()}
`)
  await fs.writeFile(path.join(initializersDirectory, "process-lifecycle-initializer.js"), `import fs from "node:fs/promises"
import Initializer from ${JSON.stringify(initializerPath)}

export default class ProcessLifecycleInitializer extends Initializer {
  async run() { await this.record("start") }
  async teardown() { await this.record("teardown") }

  async record(phase) {
    const {instanceId, type} = this.getProcessContext()
    await fs.appendFile(${JSON.stringify(eventsPath)}, JSON.stringify({instanceId, phase, type}) + "\\n")
  }
}
`)
  await fs.writeFile(path.join(jobsDirectory, "process-lifecycle-job.js"), `import Job from ${JSON.stringify(jobPath)}

export default class ProcessLifecycleJob extends Job {
  static databaseIdentifiers = []

  async perform(mode = "complete") {
    process.send?.({type: "perform-started", mode})
    if (mode === "block") await new Promise(() => {})
  }
}
`)
  await fs.writeFile(path.join(configDirectory, "configuration.js"), `import Configuration from ${JSON.stringify(configurationPath)}
import EnvironmentHandlerNode from ${JSON.stringify(environmentHandlerPath)}
import ProcessLifecycleInitializer from "../initializers/process-lifecycle-initializer.js"
import SingleMultiUsePool from ${JSON.stringify(singlePoolPath)}
import SqliteDriver from ${JSON.stringify(sqliteDriverPath)}

const initializerContext = () => ({default: ProcessLifecycleInitializer})
initializerContext.keys = () => ["process-lifecycle-initializer.js"]
initializerContext.id = "application-process-lifecycle-project"

export default new Configuration({
  backgroundJobs: ${backgroundJobsPort === undefined ? "undefined" : JSON.stringify({host: "127.0.0.1", port: backgroundJobsPort})},
  database: {test: {default: {
    driver: SqliteDriver,
    name: ${JSON.stringify(path.join(directory, "application-process.sqlite3"))},
    poolType: SingleMultiUsePool,
    type: "sqlite"
  }}},
  directory: ${JSON.stringify(directory)},
  environment: "test",
  environmentHandler: new EnvironmentHandlerNode(),
  initializers: async () => ({requireContext: initializerContext}),
  locale: "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})
`)

  return {
    cleanup: async () => await fs.rm(directory, {recursive: true, force: true}),
    directory,
    eventsPath,
    readEvents: async () => {
      try {
        const contents = await fs.readFile(eventsPath, "utf8")

        return contents
          .split("\n")
          .filter(Boolean)
          .map((line) => /** @type {ApplicationProcessLifecycleEvent} */ (JSON.parse(line)))
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return []

        throw error
      }
    }
  }
}
