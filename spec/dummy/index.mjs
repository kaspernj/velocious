import Application from "../../src/application.mjs"
import dummyConfiguration from "./src/config/configuration.mjs"

export default class Dummy {
  static current() {
    if (!this.velociousDummy) {
      this.velociousDummy = new Dummy()
    }

    return this.velociousDummy
  }

  static async prepare() {
    const db = dummyConfiguration.getDatabasePool()

    await db.withConnection(async () => {
      await db.query("DROP TABLE IF EXISTS tasks")
      await db.query("CREATE TABLE tasks (id MEDIUMINT NOT NULL AUTO_INCREMENT, name VARCHAR(255), description TEXT, PRIMARY KEY (id))")
    })
  }

  static async run(callback) {
    await this.current().run(callback)
  }

  async run(callback) {
    await dummyConfiguration.getDatabasePool().withConnection(async () => {
      await this.start()

      try {
        await Dummy.prepare()
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
