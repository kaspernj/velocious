import Migration from "../../../../../src/database/migration/index.js"

export default class ChangeAuthenticationTokensUserIdNullable extends Migration {
  async up() {
    await this.changeColumnNull("authentication_tokens", "user_id", true)
  }

  async down() {
    await this.changeColumnNull("authentication_tokens", "user_id", false)
  }
}
