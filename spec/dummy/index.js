import Application from "../../src/application.js"
import {digg} from "diggerize"
import dummyConfiguration from "./src/config/configuration.js"
import Migration from "../../src/database/migration/index.js"

export default class Dummy {
  static current() {
    if (!this.velociousDummy) {
      this.velociousDummy = new Dummy()
    }

    return this.velociousDummy
  }

  static async prepare() {
    dummyConfiguration.setCurrent()

    await dummyConfiguration.withConnections(async (dbs) => {
      const db = digg(dbs, "default")

      await db.dropTable("tasks", {ifExists: true})
      await db.dropTable("project_translations", {ifExists: true})
      await db.dropTable("projects", {ifExists: true})

      const migration = new Migration({configuration: dummyConfiguration, databaseIdentifier: "default", db})

      await migration.createTable("projects", (t) => {
        t.timestamps()
      })
      await migration.createTable("project_translations", (t) => {
        t.references("project", {null: false, foreignKey: true})
        t.string("locale", {null: false})
        t.string("name")
      })

      await migration.addIndex("project_translations", ["project_id", "locale"], {unique: true})

      await migration.createTable("tasks", (t) => {
        t.references("project")
        t.string("name")
        t.text("description")
      })

      if (!dummyConfiguration.isInitialized()) {
        await dummyConfiguration.initialize()
      }
    })
  }

  static async run(callback) {
    await this.current().run(callback)
  }

  async run(callback) {
    await dummyConfiguration.withConnections(async () => {
      await Dummy.prepare()
      await this.start()

      try {
        await callback()
      } finally {
        await this.stop()
      }
    })
  }

  async start() {
    if (!dummyConfiguration.isDatabasePoolInitialized()) {
      await dummyConfiguration.initializeDatabasePool()
    }

    this.application = new Application({
      configuration: dummyConfiguration,
      databases: {
        default: {
          host: "mysql",
          username: "user",
          password: ""
        }
      },
      httpServer: {port: 3006}
    })

    await this.application.initialize()
    await this.application.startHttpServer()
  }

  async stop() {
    if (this.application.isActive()) {
      await this.application.stop()
    }
  }
}
