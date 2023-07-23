export default class DbGenerateMigration {
  constructor({args}) {
    this.args = args
  }

  execute() {
    const migrationName = this.args[2]
    const date = new Date()

    console.log({ migrationName, date })

    throw new Error("stub")
  }
}
