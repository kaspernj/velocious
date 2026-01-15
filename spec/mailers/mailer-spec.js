// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import Configuration from "../../src/configuration.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import velociousMailer from "../../src/mailer.js"

class TasksMailer extends velociousMailer {
  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  newNotification(task, user) {
    this.task = task
    this.user = user
    this.assignView({task, user})
    this.mail({to: user.email(), subject: "New task"})
  }
}

describe("Mailers", () => {
  /**
   * @returns {Promise<{directory: string, cleanup: () => Promise<void>}>}
   */
  async function createTempProjectDir() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mailer-"))
    const viewDir = path.join(directory, "src", "mailers", "tasks")

    await fs.mkdir(viewDir, {recursive: true})
    await fs.writeFile(path.join(viewDir, "new-notification.ejs"), `<b>Hello <%= mailer.user.name() %></b>
<p>
  Task <%= task.id() %> has just been created.
</p>
`)

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
        test: {
          default: {
            driver: SqliteDriver,
            poolType: SingleMultiUsePool,
            type: "sqlite",
            name: "mailer-test",
            migrations: false
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler(),
      initializeModels: async () => {},
      locale: () => "en",
      localeFallbacks: {},
      locales: ["en"]
    })
  }

  it("renders mailer views and stores deliveries in test mode", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()

      const task = {id: () => 42}
      const user = {
        email: () => "user@example.com",
        name: () => "Tess"
      }

      await TasksMailer.newNotification(task, user).deliverNow()

      const sent = velociousMailer.deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].to).toEqual("user@example.com")
      expect(sent[0].subject).toEqual("New task")
      expect(sent[0].html).toMatch(/Hello Tess/)
      expect(sent[0].html).toMatch(/Task 42 has just been created/)
    } finally {
      await cleanup()
    }
  })

  it("clears deliveries between tests", () => {
    const sent = velociousMailer.deliveries()

    expect(sent.length).toEqual(0)
  })
})
