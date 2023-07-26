import Application from "../../src/application.mjs"
import Configuration from "../../src/configuration.mjs"
import DatabasePool from "../../src/database/pool/index.mjs"
import {dirname} from "path"
import {fileURLToPath} from "url"

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
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const configuration = new Configuration({
      debug: false,
      directory: __dirname
    })

    this.application = new Application({
      configuration,
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

    const databasePool = DatabasePool.current()

    if (!databasePool.isConnected()) {
      await databasePool.connect()
    }
  }

  async stop() {
    if (this.application.isActive()) {
      await this.application.stop()
    }
  }
}
