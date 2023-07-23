export default class DbGenerateMigration {
  constructor({args}) {
    this.args = args
  }

  execute() {
    const migrationName = this.args[1]
    const date = new Date()

    console.log({ migrationName, date })
  }
}
