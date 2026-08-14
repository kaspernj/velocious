// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import VelociousMailer from "../../src/mailer.js"

class ConfigurationBoundaryMailer extends VelociousMailer {
  /** @returns {import("../../src/mailer/delivery.js").default} - Delivery. */
  notice() {
    return this.mail({
      actionName: "notice",
      from: "sender@example.com",
      subject: "Configuration boundary",
      to: "recipient@example.com"
    })
  }
}

/**
 * Creates an isolated mail/background-job configuration.
 * @param {{directory: string, name: string, providerKind: string}} args - Configuration input.
 * @returns {Promise<Configuration>} - Isolated configuration.
 */
async function createConfiguration({directory, name, providerKind}) {
  await fs.mkdir(path.join(directory, "db"), {recursive: true})
  await fs.mkdir(path.join(directory, "src", "mailers", "configuration-boundary"), {recursive: true})
  await fs.writeFile(path.join(directory, "src", "mailers", "configuration-boundary", "notice.ejs"), "<p>Configuration boundary</p>")

  return new Configuration({
    database: {
      development: {
        default: {
          driver: SqliteDriver,
          migrations: false,
          name,
          poolType: SingleMultiUsePool,
          type: "sqlite"
        }
      }
    },
    directory,
    environment: "development",
    environmentHandler: new NodeEnvironmentHandler(),
    initializeModels: async () => {},
    locale: () => "en",
    localeFallbacks: {},
    locales: ["en"],
    mailerBackend: {
      deliver: async () => null,
      deliveryIdempotencyCapability: () => ({providerKind, retentionMs: 60_000})
    }
  })
}

describe("Mailers - idempotent delivery configuration boundary", {databaseCleaning: {transaction: true}}, () => {
  it("enqueues through the explicitly supplied configuration instead of the global current configuration", async () => {
    const previousConfiguration = Configuration.current()
    const globalDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mail-global-"))
    const explicitDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mail-explicit-"))
    const globalConfiguration = await createConfiguration({
      directory: globalDirectory,
      name: "mail-global",
      providerKind: "global-provider"
    })
    const explicitConfiguration = await createConfiguration({
      directory: explicitDirectory,
      name: "mail-explicit",
      providerKind: "explicit-provider"
    })
    const globalMain = new BackgroundJobsMain({closeDatabaseConnectionsOnStop: false, configuration: globalConfiguration, host: "127.0.0.1", port: 0})
    const explicitMain = new BackgroundJobsMain({closeDatabaseConnectionsOnStop: false, configuration: explicitConfiguration, host: "127.0.0.1", port: 0})

    try {
      await globalMain.start()
      globalConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: globalMain.getPort()})
      await explicitMain.start()
      explicitConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: explicitMain.getPort()})

      const globalStore = new BackgroundJobsStore({configuration: globalConfiguration})
      const explicitStore = new BackgroundJobsStore({configuration: explicitConfiguration})

      await globalStore.clearAll()
      await explicitStore.clearAll()
      globalConfiguration.setCurrent()

      const jobId = await new ConfigurationBoundaryMailer({configuration: explicitConfiguration}).notice().deliverLater({
        deliveryOperation: {id: "configuration-boundary:1", idempotency: "required"}
      })

      if (typeof jobId !== "string") throw new Error("Expected native mail job id")
      expect(await explicitStore.countJobs({jobName: "MailDeliveryJob"})).toEqual(1)
      expect(await globalStore.countJobs({jobName: "MailDeliveryJob"})).toEqual(0)
      expect((await explicitStore.getJob(jobId))?.id).toEqual(jobId)
      expect(await globalStore.getJob(jobId)).toEqual(null)
    } finally {
      await explicitMain.stop()
      await globalMain.stop()
      await explicitConfiguration.closeDatabaseConnections()
      await globalConfiguration.closeDatabaseConnections()
      previousConfiguration.setCurrent()
      await fs.rm(explicitDirectory, {force: true, recursive: true})
      await fs.rm(globalDirectory, {force: true, recursive: true})
    }
  })
})
