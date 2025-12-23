import Migration from "../../../../../src/database/migration/index.js"

export default class CreateInteractions extends Migration {
  async change() {
    await this.createTable("interactions", (table) => {
      table.references("subject", {null: false, polymorphic: true})
      table.string("kind")
      table.timestamps()
    })
  }
}
