import Migration from "../../../../../src/database/migration/index.js"

class CreateTenantGeneratorTenantRecords extends Migration {
  async change() {
    await this.createTable("tenant_generator_records", (table) => {
      table.integer("routing_epoch", {null: false})
      table.string("tenant_name", {null: false})
    })

    await this.createTable("tenant_only_generator_records", (table) => {
      table.string("tenant_name", {null: false})
    })
  }
}

CreateTenantGeneratorTenantRecords.onDatabases(["projectTenant"])

export default CreateTenantGeneratorTenantRecords
