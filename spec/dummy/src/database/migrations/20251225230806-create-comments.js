import Migration from "../../../../../src/database/migration/index.js"

export default class CreateComments extends Migration {
  async up() {
    if (!await this.tableExists("comments")) {
      await this.createTable("comments", (table) => {
        table.references("task", {foreignKey: true, null: false})
        table.string("body")
        table.timestamps()
      })
    }
  }

  async down() {
    if (await this.tableExists("comments")) {
      await this.dropTable("comments")
    }
  }
}
