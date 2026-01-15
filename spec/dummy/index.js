// @ts-check

import Application from "../../src/application.js"
import {digg} from "diggerize"
import dummyConfiguration from "./src/config/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
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
    const environmentHandlerNode = new EnvironmentHandlerNode()

    environmentHandlerNode.setConfiguration(dummyConfiguration)

    const migrator = new Migrator({configuration: dummyConfiguration})

    await migrator.prepare()
    await migrator.migrateFiles(await environmentHandlerNode.findMigrations(), digg(environmentHandlerNode, "requireMigration"))
  }

  /** @param {function(): Promise<any>} callback */
  static async run(callback) {
    await this.current().run(callback)
  }

  /** @param {function(): Promise<void>} callback */
  async run(callback) {
    try {
      await dummyConfiguration.ensureConnections(async () => {
        await Dummy.prepare()
        await this.start()
        await callback()
      })
    } finally {
      await this.stop()
    }
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
    if (this.application) {
      await this.application.stop()
    }
  }
}
