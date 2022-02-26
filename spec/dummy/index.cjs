const {Application} = require("../../index.cjs")

module.exports = class Dummy {
  static current() {
    if (!global.velociousDummy) {
      global.velociousDummy = new Dummy()
      global.velociousDummy.start()
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
      this.stop()
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

    this.started = true
  }

  stop() {
    this.application.stop()
  }
}
