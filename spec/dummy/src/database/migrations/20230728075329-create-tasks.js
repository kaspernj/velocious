import Migration from "../../../../../src/database/migration/index.js"

export default class CreateTasks extends Migration {
  async change() {
    await this.createTable("tasks", {id: {type: "bigint"}}, (table) => {
      table.references("project", {foreignKey: true, null: false, type: "bigint"})
      table.string("name")
      table.text("description")
      table.timestamps()
    })
  }
}
