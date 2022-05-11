import {Application} from "../../index.mjs"
import DatabasePool from "../../src/database/pool/index.mjs"

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
    await connection.query("CREATE TABLE tasks (id MEDIUMINT NOT NULL AUTO_INCREMENT, name VARCHAR(255), PRIMARY KEY (id))")
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
      databases: {
        default: {
          host: "mysql",
          username: "user",
          password: ""
        }
      },
      debug: false,
      directory: __dirname,
      httpServer: {port: 3006}
    })

    await this.application.start()

    const databasePool = DatabasePool.current()

    if (!databasePool.isConnected()) {
      await databasePool.connect()
    }
  }

  async stop() {
    if (this.application.isActive())
      await this.application.stop()
  }
}
