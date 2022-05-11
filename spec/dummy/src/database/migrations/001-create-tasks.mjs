import {Database: {Migration}} from "../../../../index.mjs"

export default class CreateTasks extends Migration {
  change() {
    this.createTable("tasks", (table) => {
      table.column("id", {autoIncrement: true, primaryKey: true})
      table.timestamps()
    })
  }
}
