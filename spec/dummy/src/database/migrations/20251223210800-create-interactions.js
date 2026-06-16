import Migration from "../../../../../src/database/migration/index.js"

export default class CreateInteractions extends Migration {
  async up() {
    if (!await this.tableExists("interactions")) {
      await this.createTable("interactions", {id: {type: "bigint"}}, (table) => {
        table.references("subject", {null: false, polymorphic: true, type: "bigint"})
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
