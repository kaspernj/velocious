import Migration from "../../../../../src/database/migration/index.js"

class CreateTenantGeneratorControlRecords extends Migration {
  async up() {
    await this.createTable("tenant_generator_records", (table) => {
      table.string("control_name", {null: false})
    })
  }

  async down() {
    await this.dropTable("tenant_generator_records")
  }
}

CreateTenantGeneratorControlRecords.onDatabases(["default"])

export default CreateTenantGeneratorControlRecords
