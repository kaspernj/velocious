import Migration from "../../../../../src/database/migration/index.js"

export default class CreateUsers extends Migration {
  async up() {
    await this.createTable("users", (t) => {
      t.string("email", {index: {unique: true}, null: false})
      t.string("encrypted_password", {null: false})
      t.string("reference")
      t.timestamps()
    })
  }

  async down() {
    await this.dropTable("users")
  }
}
