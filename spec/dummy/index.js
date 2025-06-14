import Application from "../../src/application.js"
import dummyConfiguration from "./src/config/configuration.js"

export default class Dummy {
  static current() {
    if (!this.velociousDummy) {
      this.velociousDummy = new Dummy()
    }

    return this.velociousDummy
  }

  static async prepare() {
    dummyConfiguration.setCurrent()

    const db = dummyConfiguration.getDatabasePool()

    await db.withConnection(async () => {
      await db.query("DROP TABLE IF EXISTS tasks")
      await db.query("DROP TABLE IF EXISTS project_translations")
      await db.query("DROP TABLE IF EXISTS projects")

      await db.query("CREATE TABLE tasks (id MEDIUMINT NOT NULL AUTO_INCREMENT, project_id MEDIUMINT, name VARCHAR(255), description TEXT, PRIMARY KEY (id))")
      await db.query("CREATE TABLE projects (id MEDIUMINT NOT NULL AUTO_INCREMENT, PRIMARY KEY (id))")
      await db.query("CREATE TABLE project_translations (id MEDIUMINT NOT NULL AUTO_INCREMENT, project_id MEDIUMINT, locale VARCHAR(255), name VARCHAR(255), PRIMARY KEY (id))")
      await db.query("CREATE UNIQUE INDEX unique_project_translation ON project_translations (project_id, locale)")

      if (!dummyConfiguration.isInitialized()) {
        await dummyConfiguration.initialize()
      }
    })
  }

  static async run(callback) {
    await this.current().run(callback)
  }

  async run(callback) {
    await dummyConfiguration.getDatabasePool().withConnection(async () => {
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
