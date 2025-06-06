import Migration from "../../../../../src/database/migration/index.mjs"

export default class CreateTasks extends Migration {
  async change() {
    await this.createTable("tasks", (table) => {
      table.references("project")
      table.string("name")
      table.text("description")
      table.timestamps()
    })
  }
}
