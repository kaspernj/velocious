import DatabasePool from "../../../database/pool/index.mjs"

export default class DbCreate {
  constructor({args}) {
    this.args = args
  }

  async initialize() {
    const database = DatabasePool.current()

    await database.connect()
    this.databaseConnection = database.singleConnection()
  }

  async execute() {
    const migrationName = this.args[2]
    const date = new Date()

    console.log({ migrationName, date })

    throw new Error("stub")
  }
}
