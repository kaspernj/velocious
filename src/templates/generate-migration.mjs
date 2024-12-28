import Migration from "velocious/src/database/migration/index.mjs"

export default class __MIGRATION_NAME__ extends Migration {
  async up() {
    await this.connection().execute("...")
  }

  async down() {
    await this.connection().execute("...")
  }
}
