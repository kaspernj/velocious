// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import Configuration from "../../src/configuration.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import VelociousMailer, {clearDeliveries, deliveries} from "../../src/mailer.js"

class TasksMailer extends VelociousMailer {
  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  assignTaskNotification(task, user) {
    this.task = task
    this.user = user
    this.assignView({task, user, userName: user.name()})
  }

  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  newNotification(task, user) {
    this.assignTaskNotification(task, user)
    return this.mail({to: user.email(), subject: "New task"})
  }

  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  renamedNotification(task, user) {
    this.assignTaskNotification(task, user)
    return this.mail({to: user.email(), subject: "Explicit task", actionName: "explicitNotification"})
  }

  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  delegatedNotification(task, user) {
    this.assignTaskNotification(task, user)
    return this.composeNotification({subject: "Delegated task", to: user.email()})
  }

  /**
   * @param {object} args - Delivery args.
   * @param {string} args.subject - Subject line.
   * @param {string} args.to - Recipient address.
   * @returns {import("../../src/mailer/delivery.js").default}
   */
  composeNotification({subject, to}) {
    return this.mail({to, subject})
  }

  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {import("../../src/mailer/delivery.js").default}
   */
  delayedNotification(task, user) {
    return this.mail({
      to: user.email(),
      subject: "Delayed task",
      actionName: "delayedNotification",
      actionPromise: (async () => {
        await Promise.resolve()
        this.assignView({task, user, userName: user.name()})
      })()
    })
  }
}

describe("Mailers", {databaseCleaning: {transaction: true}}, () => {
  /**
   * @returns {Promise<{directory: string, cleanup: () => Promise<void>}>}
   */
  async function createTempProjectDir() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mailer-"))
    const viewDir = path.join(directory, "src", "mailers", "tasks")

    await fs.mkdir(viewDir, {recursive: true})
    await fs.writeFile(path.join(viewDir, "new-notification.ejs"), `<b><%= _("Hello %{userName}", {userName}) %></b>
<p>
  Task <%= task.id() %> has just been created.
</p>
`)
    await fs.writeFile(path.join(viewDir, "explicit-notification.ejs"), `<b><%= _("Hello %{userName}", {userName}) %></b>
<p>
  Explicit task <%= task.id() %> has just been created.
</p>
`)
    await fs.writeFile(path.join(viewDir, "delegated-notification.ejs"), `<b><%= _("Hello %{userName}", {userName}) %></b>
<p>
  Delegated task <%= task.id() %> has just been created.
</p>
`)
    await fs.writeFile(path.join(viewDir, "delayed-notification.ejs"), `<b><%= _("Hello %{userName}", {userName}) %></b>
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
    const databaseName = "mailer-test"

    return new Configuration({
      database: {
        test: {
          default: {
            name: databaseName,
            type: "sqlite",
            driver: SqliteDriver,
            migrations: false,
            poolType: SingleMultiUsePool,
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

  /**
   * @param {string} directory - Project directory.
   * @returns {void}
   */
  function setCurrentTestConfiguration(directory) {
    createConfiguration(directory).setCurrent()
  }

  /** @returns {{email: () => string, name: () => string}} */
  function namedUser(email, name) {
    return {email: () => email, name: () => name}
  }

  /** @returns {{id: () => number}} */
  function taskWithId(id) {
    return {id: () => id}
  }

  /**
   * @param {RegExp} content - Expected rendered content.
   * @returns {import("../../src/mailer.js").MailerDeliveryPayload} Sent payload.
   */
  function firstDeliveryMatching(content) {
    const sent = deliveries()

    expect(sent.length).toEqual(1)
    expect(sent[0].html).toMatch(content)

    return sent[0]
  }

  /**
   * @param {(directory: string) => Promise<void>} callback - Test callback.
   * @returns {Promise<void>}
   */
  async function withTempMailerProject(callback) {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      await callback(directory)
    } finally {
      await cleanup()
    }
  }

  it("renders mailer views and stores deliveries in test mode", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)

      const task = taskWithId(42)
      const user = namedUser("user@example.com", "Tess")

      await new TasksMailer().newNotification(task, user).deliverNow()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].to).toEqual("user@example.com")
      expect(sent[0].subject).toEqual("New task")
      expect(sent[0].html).toMatch(/Hello Tess/)
      expect(sent[0].html).toMatch(/Task 42 has just been created/)
    })
  })

  it("infers action names from mailer action methods", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)
      clearDeliveries()

      const task = taskWithId(43)
      const user = namedUser("inferred@example.com", "Inga")

      await new TasksMailer().newNotification(task, user).deliverNow()

      const sent = firstDeliveryMatching(/Hello Inga/)

      expect(sent.action).toEqual("newNotification")
    })
  })

  it("uses explicit action names when provided", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)
      clearDeliveries()

      const task = taskWithId(44)
      const user = namedUser("explicit@example.com", "Eli")

      await new TasksMailer().renamedNotification(task, user).deliverNow()

      const sent = firstDeliveryMatching(/Explicit task 44 has just been created/)

      expect(sent.action).toEqual("explicitNotification")
    })
  })

  it("infers action names past delegated helper methods", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)
      clearDeliveries()

      const task = taskWithId(45)
      const user = namedUser("delegated@example.com", "Dee")

      await new TasksMailer().delegatedNotification(task, user).deliverNow()

      const sent = firstDeliveryMatching(/Delegated task 45 has just been created/)

      expect(sent.action).toEqual("delegatedNotification")
    })
  })

  it("builds a rendered payload without delivering it", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)
      clearDeliveries()

      const task = taskWithId(51)
      const user = namedUser("preview@example.com", "Priya")

      const payload = await new TasksMailer().delayedNotification(task, user).buildPayload()

      expect(payload.to).toEqual("preview@example.com")
      expect(payload.subject).toEqual("Delayed task")
      expect(payload.mailer).toEqual("TasksMailer")
      expect(payload.action).toEqual("delayedNotification")
      expect(payload.html).toMatch(/Hello Priya/)
      expect(payload.html).toMatch(/Task 51 has just been created/)
      expect(deliveries().length).toEqual(0)
    })
  })

  it("returns a delivery wrapper from instance actions", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)

      const task = taskWithId(7)
      const user = namedUser("instance@example.com", "Ina")

      await new TasksMailer().newNotification(task, user).deliverLater()

      const sent = firstDeliveryMatching(/Hello Ina/)

      expect(sent.to).toEqual("instance@example.com")
      expect(sent.subject).toEqual("New task")
      expect(sent.html).toMatch(/Task 7 has just been created/)
    })
  })

  it("awaits actionPromise before delivering", async () => {
    await withTempMailerProject(async (directory) => {
      setCurrentTestConfiguration(directory)

      const task = taskWithId(99)
      const user = namedUser("delay@example.com", "Dana")

      await new TasksMailer().delayedNotification(task, user).deliverNow()

      const sent = firstDeliveryMatching(/Hello Dana/)

      expect(sent.to).toEqual("delay@example.com")
      expect(sent.subject).toEqual("Delayed task")
      expect(sent.html).toMatch(/Task 99 has just been created/)
    })
  })

  it("clears deliveries between tests", () => {
    const sent = deliveries()

    expect(sent.length).toEqual(0)
  })
})
