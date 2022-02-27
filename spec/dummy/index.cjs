const {Application} = require("../../index.cjs")

module.exports = class Dummy {
  static current() {
    if (!global.velociousDummy) {
      global.velociousDummy = new Dummy()
    }

    return global.velociousDummy
  }

  static async run(callback) {
    await this.current().run(callback)
  }

  async run(callback) {
    await this.start()

    try {
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
  }

  async stop() {
    if (this.application.isActive())
      await this.application.stop()
  }
}
