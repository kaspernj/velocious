export default class VelociousBigBrother {
  constructor() {
    this.enabledLoggers = {
      databaseQuery: false
    }
  }

  checkExists(name) {
    if (!(name in this.enabledLoggers)) throw new Error(`Invalid logger name: ${name}`)
  }

  isEnabled(name) {
    this.checkExists(name)

    return this.enabledLoggers[name]
  }

  async run({after, before, name}, callback) {
    this.checkExists(name)

    if (!this.enabledLoggers[name]) {
      return await callback()
    }

    if (before) {
      before()
    }

    const startTime = new Date()
    const result = await callback()
    const endTime = new Date()

    if (after) {
      after({result})
    }
  }
}
