import Migration from "../../../../../src/database/migration/index.js"

export default class CreateInteractions extends Migration {
  async up() {
    if (!await this.tableExists("interactions")) {
      await this.createTable("interactions", (table) => {
        table.references("subject", {null: false, polymorphic: true})
        table.string("kind")
        table.timestamps()
      })
    }
  }

  async down() {
    if (await this.tableExists("interactions")) {
      await this.dropTable("interactions")
    }
  }
}
