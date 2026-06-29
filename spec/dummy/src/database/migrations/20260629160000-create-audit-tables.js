import Migration from "../../../../../src/database/migration/index.js"

export default class CreateAuditTables extends Migration {
  async up() {
    await this.createTable("audit_actions", (table) => {
      table.string("action", {index: {unique: true}, null: false})
      table.timestamps()
    })

    await this.createTable("audit_auditable_types", (table) => {
      table.string("name", {index: {unique: true}, null: false})
      table.timestamps()
    })

    await this.createTable("audits", (table) => {
      table.references("audit_action", {foreignKey: true, null: false})
      table.references("audit_auditable_type", {foreignKey: true, null: false})
      table.references("auditable", {null: false, polymorphic: true, type: "bigint"})
      table.json("audited_changes")
      table.json("params")
      table.timestamps()
    })
  }

  async down() {
    await this.dropTable("audits")
    await this.dropTable("audit_auditable_types")
    await this.dropTable("audit_actions")
  }
}
