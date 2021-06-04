const {Application} = require("../../index.cjs")
const path = require("path")

module.exports = class Dummy {
  static run(callback) {
    const dummy = new Dummy()

    dummy.run(callback)
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
    const dummyDirectory = path.join(__dirname, "../../dummy")

    this.application = new Application({
      debug: false,
      directory: dummyDirectory,
      httpServer: {port: 3006}
    })

    await this.application.start()
  }

  stop() {
    this.application.stop()
  }
}
