import {Database} from "../../../../index.mjs"

export default class CreateTasks extends Database.Migration {
  change() {
    this.createTable("tasks", (table) => {
      table.bigint("id", {autoIncrement: true, primaryKey: true})
      table.string("name")
      table.timestamps()
    })
  }
}
