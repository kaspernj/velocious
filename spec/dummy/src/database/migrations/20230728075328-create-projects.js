import Migration from "../../../../../src/database/migration/index.js"

export default class CreateProjects extends Migration {
  async change() {
    await this.createTable("projects", {id: {type: "bigint"}}, (t) => {
      t.string("creating_user_reference")
      t.timestamps()
    })
  }
}
