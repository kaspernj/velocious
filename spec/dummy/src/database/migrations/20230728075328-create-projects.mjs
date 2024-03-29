import Migration from "../../../../../src/database/migration/index.mjs"

export default class CreateProjects extends Migration {
  async change() {
    await this.createTable("projects", (table) => {
      table.bigint("id", {autoIncrement: true, primaryKey: true})
      table.string("name", {maxLength: 100, null: false})
      table.timestamps()
    })
  }
}
