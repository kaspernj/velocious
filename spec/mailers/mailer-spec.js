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
  newNotification(task, user) {
    this.task = task
    this.user = user
    this.assignView({task, user, userName: user.name()})
    return this.mail({to: user.email(), subject: "New task"})
  }

  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  renamedNotification(task, user) {
    this.task = task
    this.user = user
    this.assignView({task, user, userName: user.name()})
    return this.mail({to: user.email(), subject: "Explicit task", actionName: "explicitNotification"})
  }

  /**
   * @param {{id: () => number}} task
   * @param {{email: () => string, name: () => string}} user
   * @returns {void}
   */
  delegatedNotification(task, user) {
    this.task = task
    this.user = user
    this.assignView({task, user, userName: user.name()})
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

      await new TasksMailer().newNotification(task, user).deliverNow()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].to).toEqual("user@example.com")
      expect(sent[0].subject).toEqual("New task")
      expect(sent[0].html).toMatch(/Hello Tess/)
      expect(sent[0].html).toMatch(/Task 42 has just been created/)
    } finally {
      await cleanup()
    }
  })

  it("infers action names from mailer action methods", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()
      clearDeliveries()

      const task = {id: () => 43}
      const user = {
        email: () => "inferred@example.com",
        name: () => "Inga"
      }

      await new TasksMailer().newNotification(task, user).deliverNow()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].action).toEqual("newNotification")
      expect(sent[0].html).toMatch(/Hello Inga/)
    } finally {
      await cleanup()
    }
  })

  it("uses explicit action names when provided", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()
      clearDeliveries()

      const task = {id: () => 44}
      const user = {
        email: () => "explicit@example.com",
        name: () => "Eli"
      }

      await new TasksMailer().renamedNotification(task, user).deliverNow()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].action).toEqual("explicitNotification")
      expect(sent[0].html).toMatch(/Explicit task 44 has just been created/)
    } finally {
      await cleanup()
    }
  })

  it("infers action names past delegated helper methods", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()
      clearDeliveries()

      const task = {id: () => 45}
      const user = {
        email: () => "delegated@example.com",
        name: () => "Dee"
      }

      await new TasksMailer().delegatedNotification(task, user).deliverNow()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].action).toEqual("delegatedNotification")
      expect(sent[0].html).toMatch(/Delegated task 45 has just been created/)
    } finally {
      await cleanup()
    }
  })

  it("builds a rendered payload without delivering it", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()
      clearDeliveries()

      const task = {id: () => 51}
      const user = {
        email: () => "preview@example.com",
        name: () => "Priya"
      }

      const payload = await new TasksMailer().delayedNotification(task, user).buildPayload()

      expect(payload.to).toEqual("preview@example.com")
      expect(payload.subject).toEqual("Delayed task")
      expect(payload.mailer).toEqual("TasksMailer")
      expect(payload.action).toEqual("delayedNotification")
      expect(payload.html).toMatch(/Hello Priya/)
      expect(payload.html).toMatch(/Task 51 has just been created/)
      expect(deliveries().length).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("returns a delivery wrapper from instance actions", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()

      const task = {id: () => 7}
      const user = {
        email: () => "instance@example.com",
        name: () => "Ina"
      }

      await new TasksMailer().newNotification(task, user).deliverLater()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].to).toEqual("instance@example.com")
      expect(sent[0].subject).toEqual("New task")
      expect(sent[0].html).toMatch(/Hello Ina/)
      expect(sent[0].html).toMatch(/Task 7 has just been created/)
    } finally {
      await cleanup()
    }
  })

  it("awaits actionPromise before delivering", async () => {
    const {directory, cleanup} = await createTempProjectDir()

    try {
      const configuration = createConfiguration(directory)
      configuration.setCurrent()

      const task = {id: () => 99}
      const user = {
        email: () => "delay@example.com",
        name: () => "Dana"
      }

      await new TasksMailer().delayedNotification(task, user).deliverNow()

      const sent = deliveries()

      expect(sent.length).toEqual(1)
      expect(sent[0].to).toEqual("delay@example.com")
      expect(sent[0].subject).toEqual("Delayed task")
      expect(sent[0].html).toMatch(/Hello Dana/)
      expect(sent[0].html).toMatch(/Task 99 has just been created/)
    } finally {
      await cleanup()
    }
  })

  it("clears deliveries between tests", () => {
    const sent = deliveries()

    expect(sent.length).toEqual(0)
  })
})
