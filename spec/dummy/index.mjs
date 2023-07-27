import Application from "../../src/application.mjs"
import DatabasePool from "../../src/database/pool/index.mjs"
import dummyConfiguration from "./src/config/configuration.mjs"

export default class Dummy {
  static current() {
    if (!global.velociousDummy) {
      global.velociousDummy = new Dummy()
    }

    return global.velociousDummy
  }

  static async prepare() {
    const connection = DatabasePool.current().singleConnection()

    await connection.query("DROP TABLE IF EXISTS tasks")
    await connection.query("CREATE TABLE tasks (id MEDIUMINT NOT NULL AUTO_INCREMENT, name VARCHAR(255), description TEXT, PRIMARY KEY (id))")
  }

  static async run(callback) {
    await this.current().run(callback)
  }

  async run(callback) {
    await this.start()

    try {
      await Dummy.prepare()
      await callback()
    } finally {
      await this.stop()
    }
  }

  async start() {
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
