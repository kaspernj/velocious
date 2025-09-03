import Migration from "../../../../../src/database/migration/index.js"

export default class CreateAccounts extends Migration {
  async up() {
    await this.createTable("accounts", {on: "mssql"}, (t) => {
      t.string("name")
      t.timestamps()
    })
  }

  async down() {
    await this.connection().execute("...")
  }
}
