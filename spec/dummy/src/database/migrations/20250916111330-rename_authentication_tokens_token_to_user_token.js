import Migration from "../../../../../src/database/migration/index.js"

export default class RenameAuthenticationTokensTokenToUserToken extends Migration {
  async up() {
    await this.renameColumn("authentication_tokens", "token", "user_token")
  }

  async down() {
    await this.renameColumn("authentication_tokens", "user_token", "token")
  }
}
