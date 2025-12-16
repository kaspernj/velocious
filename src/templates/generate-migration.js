import Migration from "velocious/dist/src/database/migration/index.js"

export default class __MIGRATION_NAME__ extends Migration {
  async up() {
    await this.execute("...")
  }

  async down() {
    await this.execute("...")
  }
}
