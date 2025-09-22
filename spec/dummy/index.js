import Application from "../../src/application.js"
import dummyConfiguration from "./src/config/configuration.js"
import FilesFinder from "../../src/database/migrator/files-finder.js"
import Migrator from "../../src/database/migrator.js"

export default class Dummy {
  static current() {
    if (!this.velociousDummy) {
      this.velociousDummy = new Dummy()
    }

    return this.velociousDummy
  }

  static async prepare() {
    dummyConfiguration.setCurrent()

    await dummyConfiguration.ensureConnections(async () => {
      await this.runMigrations()

      if (!dummyConfiguration.isInitialized()) {
        await dummyConfiguration.initialize()
      }
    })
  }

  static async runMigrations() {
    const migrationsPath = `${import.meta.dirname}/src/database/migrations`
    const files = await new FilesFinder({path: migrationsPath}).findFiles()
    const migrator = new Migrator({configuration: dummyConfiguration})

    await migrator.prepare()
    await migrator.migrateFiles(files, async (path) => await import(path))
  }

  static async run(callback) {
    await this.current().run(callback)
  }

  async run(callback) {
    await dummyConfiguration.ensureConnections(async () => {
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
      httpServer: {
        maxWorkers: 1,
        port: 3006
      },
      type: "dummy"
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
