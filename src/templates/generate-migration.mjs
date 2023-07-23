export default class __MIGRATION_NAME__ extends Database.Migration {
  async up() {
    await this.connection().execute("...")
  }

  async down() {
    await this.connection().execute("...")
  }
}
