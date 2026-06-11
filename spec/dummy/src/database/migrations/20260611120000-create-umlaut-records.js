import Migration from "../../../../../src/database/migration/index.js"

export default class CreateUmlautRecords extends Migration {
  async up() {
    if (!await this.tableExists("umlaut_records")) {
      await this.createTable("umlaut_records", (table) => {
        table.integer("Plätze")
        table.string("IP")
      })
    }
  }

  async down() {
    if (await this.tableExists("umlaut_records")) {
      await this.dropTable("umlaut_records")
    }
  }
}
