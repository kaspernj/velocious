// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import {fileURLToPath} from "url"
import Configuration from "../../src/configuration.js"
import BackgroundJobRegistry from "../../src/background-jobs/job-registry.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"

describe("Background jobs - registry", () => {
  /**
   * @returns {Promise<{directory: string, cleanup: () => Promise<void>}>}
   */
  async function createTempProjectDir() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-jobs-"))
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})

    return {
      directory,
      cleanup: async () => {
        await fs.rm(directory, {recursive: true, force: true})
      }
    }
  }

  /**
   * @param {string} directory
   * @returns {Configuration}
   */
  function createConfiguration(directory) {
    return new Configuration({
      database: {
        development: {
          default: {
            driver: SqliteDriver,
            poolType: SingleMultiUsePool,
            type: "sqlite",
            name: "jobs-registry-test",
            migrations: false
          }
        }
      },
      directory,
      environmentHandler: new NodeEnvironmentHandler(),
      initializeModels: async () => {},
      locale: () => "en",
      localeFallbacks: {},
      locales: ["en"]
    })
  }

  it("throws when a job class does not extend VelociousJob", async () => {
    const {directory, cleanup} = await createTempProjectDir()
    const jobFile = path.join(directory, "src", "jobs", "bad-job.js")
    const jobContents = "export default class BadJob {}"

    await fs.writeFile(jobFile, jobContents)

    const configuration = createConfiguration(directory)
    const registry = new BackgroundJobRegistry({configuration})

    await expect(async () => {
      await registry.load()
    }).toThrowError(`Job class must extend VelociousJob: ${jobFile}`)

    await cleanup()
  })

  it("throws when multiple jobs share the same name", async () => {
    const {directory, cleanup} = await createTempProjectDir()
    const testDir = path.dirname(fileURLToPath(import.meta.url))
    const jobPath = path.join(testDir, "..", "..", "src", "background-jobs", "job.js")
    const jobFile1 = path.join(directory, "src", "jobs", "first.js")
    const jobFile2 = path.join(directory, "src", "jobs", "second.js")
    const jobContents = `import VelociousJob from "${jobPath}"

export default class DuplicateJob extends VelociousJob {}
`

    await fs.writeFile(jobFile1, jobContents)
    await fs.writeFile(jobFile2, jobContents)

    const configuration = createConfiguration(directory)
    const registry = new BackgroundJobRegistry({configuration})

    await expect(async () => {
      await registry.load()
    }).toThrowError(`Duplicate job name "DuplicateJob" from ${jobFile2}`)

    await cleanup()
  })

  it("prefers the app job when a built-in job has the same name", async () => {
    const {directory, cleanup} = await createTempProjectDir()
    const testDir = path.dirname(fileURLToPath(import.meta.url))
    const jobPath = path.join(testDir, "..", "..", "src", "background-jobs", "job.js")
    const jobFile = path.join(directory, "src", "jobs", "mail-delivery.js")
    const jobContents = `import VelociousJob from "${jobPath}"

export default class MailDeliveryJob extends VelociousJob {
  static source() {
    return "app"
  }
}
`

    await fs.writeFile(jobFile, jobContents)

    const configuration = createConfiguration(directory)
    const registry = new BackgroundJobRegistry({configuration})

    await registry.load()

    const jobClass = registry.getJobByName("MailDeliveryJob")

    expect(jobClass.source()).toEqual("app")

    await cleanup()
  })

  it("throws when requesting an unknown job", async () => {
    const {directory, cleanup} = await createTempProjectDir()
    const configuration = createConfiguration(directory)
    const registry = new BackgroundJobRegistry({configuration})

    await registry.load()

    expect(() => {
      registry.getJobByName("MissingJob")
    }).toThrowError('Unknown job "MissingJob". Check src/jobs')

    await cleanup()
  })
})
