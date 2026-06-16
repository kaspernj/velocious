import Migration from "../../../../../src/database/migration/index.js"

class CreateAccounts extends Migration {
  async up() {
    await this.createTable("accounts", {id: {type: "bigint"}}, (t) => {
      t.string("name")
      t.timestamps()
    })
  }

  async down() {
    await this.dropTable("accounts")
  }
}

CreateAccounts.onDatabases(process.env.VELOCIOUS_DISABLE_MSSQL === "1" ? ["default"] : ["mssql"])

export default CreateAccounts
