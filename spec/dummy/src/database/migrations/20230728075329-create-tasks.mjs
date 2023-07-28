import {Database} from "../../../../index.mjs"

export default class CreateTasks extends Database.Migration {
  async change() {
    await this.createTable("tasks", (table) => {
      table.bigint("id", {autoIncrement: true, primaryKey: true})
      table.references("project")
      table.string("name")
      table.text("description")
      table.timestamps()
    })
  }
}
