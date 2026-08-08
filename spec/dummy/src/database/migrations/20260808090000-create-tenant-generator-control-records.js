import Migration from "../../../../../src/database/migration/index.js"

class CreateTenantGeneratorControlRecords extends Migration {
  async change() {
    await this.createTable("tenant_generator_records", (table) => {
      table.string("control_name", {null: false})
    })
  }
}

CreateTenantGeneratorControlRecords.onDatabases(["default"])

export default CreateTenantGeneratorControlRecords
