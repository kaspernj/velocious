import {Database} from "velocious"

export default class CreateProjects extends Database.Migration {
  async change() {
    await this.createTable("projects", (table) => {
      table.bigint("id", {autoIncrement: true, primaryKey: true})
      table.string("name", {maxLength: 100, null: false})
      table.timestamps()
    })
  }
}
