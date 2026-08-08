import Migration from "../../../../../src/database/migration/index.js"

class CreateTenantGeneratorTenantRecords extends Migration {
  async up() {
    await this.createTable("tenant_generator_records", (table) => {
      table.integer("routing_epoch", {null: false})
      table.string("tenant_name", {null: false})
    })

    await this.createTable("tenant_only_generator_records", (table) => {
      table.string("tenant_name", {null: false})
    })
  }

  async down() {
    await this.dropTable("tenant_only_generator_records")
    await this.dropTable("tenant_generator_records")
  }
}

CreateTenantGeneratorTenantRecords.onDatabases(["projectTenant"])

export default CreateTenantGeneratorTenantRecords
