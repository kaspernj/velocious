const {Application} = require("../../index.cjs")

module.exports = class Dummy {
  static async run(callback) {
    const dummy = new Dummy()

    await dummy.run(callback)
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
      debug: false,
      directory: __dirname,
      httpServer: {port: 3006}
    })

    await this.application.start()
  }

  stop() {
    this.application.stop()
  }
}
