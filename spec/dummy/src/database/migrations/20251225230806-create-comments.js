import Migration from "../../../../../src/database/migration/index.js"

export default class CreateComments extends Migration {
  async up() {
    if (!await this.tableExists("comments")) {
      await this.createTable("comments", {id: {type: "bigint"}}, (table) => {
        table.references("task", {foreignKey: true, null: false, type: "bigint"})
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
