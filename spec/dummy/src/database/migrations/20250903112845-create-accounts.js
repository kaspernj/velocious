import Migration from "../../../../../src/database/migration/index.js"

class CreateAccounts extends Migration {
  async up() {
    if (!this.tableExists("accounts")) {
      await this.createTable("accounts", (t) => {
        t.string("name")
        t.timestamps()
      })
    }
  }

  async down() {
    await this.dropTable("accounts")
  }
}

CreateAccounts.onDatabases(["mssql"])

export default CreateAccounts
