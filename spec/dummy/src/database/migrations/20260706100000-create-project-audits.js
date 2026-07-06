import Migration, {dedicatedAuditTableName} from "../../../../../src/database/migration/index.js"

export default class CreateProjectAudits extends Migration {
  async up() {
    await this.createDedicatedAuditTable("projects")
  }

  async down() {
    await this.dropTable(dedicatedAuditTableName("projects"))
  }
}
