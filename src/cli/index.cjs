module.exports = class VelociousCli {
  execute(...args) {
    if (args[0] == "g" && args[1] == "migration") {
      const migrationName = args[2]
      const date = new Date()

      console.log({ migrationName, date })
    } else {
      throw new Error(`Unknown command: ${args.join(" ")}`)
    }
  }
}
