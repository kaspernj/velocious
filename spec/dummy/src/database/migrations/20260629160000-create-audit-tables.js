import Migration from "../../../../../src/database/migration/index.js"

export default class CreateAuditTables extends Migration {
  async up() {
    await this.createSharedAuditTables()
  }

  async down() {
    await this.dropTable("audits")
    await this.dropTable("audit_auditable_types")
    await this.dropTable("audit_actions")
  }
}
