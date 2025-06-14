import Migration from "../../../../../src/database/migration/index.js"

export default class CreateTasks extends Migration {
  async change() {
    await this.createTable("tasks", (table) => {
      table.references("project", {foreignKey: true, null: false})
      table.string("name")
      table.text("description")
      table.timestamps()
    })
  }
}
