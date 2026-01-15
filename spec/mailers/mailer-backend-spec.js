// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import Configuration from "../../src/configuration.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import velociousMailer from "../../src/mailer.js"

/**
 * @extends {import("../../src/mailer.js").default}
 */
class BackendMailer extends velociousMailer {
  notice() {
    this.mail({to: "backend@example.com", subject: "Backend mail"})
  }
}

describe("Mailers - backend", () => {
  /**
   * @returns {Promise<{directory: string, cleanup: () => Promise<void>}>}
   */
  async function createTempProjectDir() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mailer-backend-"))
    const viewDir = path.join(directory, "src", "mailers", "backend")

    await fs.mkdir(viewDir, {recursive: true})
    await fs.writeFile(path.join(viewDir, "notice.ejs"), "Backend mail")

    return {
      directory,
      cleanup: async () => {
        await fs.rm(directory, {recursive: true, force: true})
      }
    }
  }

  /**
   * @param {string} directory
   * @param {import("../../src/configuration-types.js").MailerBackend} mailerBackend
   * @returns {Configuration}
   */
  function createConfiguration(directory, mailerBackend) {
    return new Configuration({
      database: {
        development: {
          default: {
            driver: SqliteDriver,
            poolType: SingleMultiUsePool,
            type: "sqlite",
            name: "mailer-backend-test",
            migrations: false
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
      mailerBackend
    })
  }

  it("delivers via the configured backend", async () => {
    const {directory, cleanup} = await createTempProjectDir()
    let previousConfiguration

    try {
      try {
        previousConfiguration = Configuration.current()
      } catch {
        previousConfiguration = null
      }

      const deliveries = []
      const backend = {
        deliver: async ({payload}) => {
          deliveries.push(payload)
        }
      }

      const configuration = createConfiguration(directory, backend)
      configuration.setCurrent()

      await BackendMailer.notice().deliverNow()

      expect(deliveries.length).toEqual(1)
      expect(deliveries[0].to).toEqual("backend@example.com")
    } finally {
      if (previousConfiguration) previousConfiguration.setCurrent()
      await cleanup()
    }
  })
})
