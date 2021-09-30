const {Database: {Migration}} = require("../../../../index.cjs")

module.exports = class CreateTasks extends Migration {
  change() {
    this.createTable("tasks", (table) => {
      table.column("id", {autoIncrement: true, primaryKey: true})
      table.timestamps()
    })
  }
}
