import Migration from "../../../../../src/database/migration/index.js"

export default class CreateAuthenticationTokens extends Migration {
  async up() {
    await this.createTable("authentication_tokens", (t) => {
      t.string("token", {default: () => "UUID()", index: {unique: true}})
      t.references("user", {foreignKey: true, null: false})
      t.timestamps()
    })
  }

  async down() {
    await this.dropTable("authentication_tokens")
  }
}
