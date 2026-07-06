import Migration from "../../../../../src/database/migration/index.js"

export default class CreateProjectAudits extends Migration {
  async up() {
    await this.createTable("project_audits", (table) => {
      table.references("project", {foreignKey: true, null: false})
      table.references("audit_action", {foreignKey: true, null: false})
      table.json("audited_changes")
      table.json("params")
      table.timestamps()
    })
  }

  async down() {
    await this.dropTable("project_audits")
  }
}
