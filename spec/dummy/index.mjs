import Application from "../../src/application.mjs"
import dummyConfiguration from "./src/config/configuration.mjs"
import InitializerFromRequireContext from "../../src/database/initializer-from-require-context.mjs"
import fs from "fs/promises"
import path from "path"
import requireContext from "require-context"

export default class Dummy {
  static current() {
    if (!this.velociousDummy) {
      this.velociousDummy = new Dummy()
    }

    return this.velociousDummy
  }

  static async initializeModels() {
    if (this._initializedModels) throw new Error("Models already initialized")

    const modelsPath = await fs.realpath(`${path.dirname(import.meta.dirname)}/dummy/src/models`)
    const requireContextModels = requireContext(modelsPath, true, /^(.+)\.mjs$/)
    const initializerFromRequireContext = new InitializerFromRequireContext(requireContextModels)

    await initializerFromRequireContext.initialize()

    this._initializedModels = true
  }

  static async prepare() {
    const db = dummyConfiguration.getDatabasePool()

    await db.withConnection(async () => {
      await db.query("DROP TABLE IF EXISTS tasks")
      await db.query("CREATE TABLE tasks (id MEDIUMINT NOT NULL AUTO_INCREMENT, name VARCHAR(255), description TEXT, PRIMARY KEY (id))")

      if (!this._initializedModels) {
        await this.initializeModels()
      }
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
