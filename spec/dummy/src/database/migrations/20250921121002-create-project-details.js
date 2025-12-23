import Migration from "../../../../../src/database/migration/index.js"

export default class CreateProjectDetails extends Migration {
  async up() {
    if (!await this.tableExists("project_details")) {
      await this.createTable("project_details", (t) => {
        t.references("project", {foreignKey: true, null: false})
        t.text("note")
        t.timestamps()
      })
    }
  }

  async down() {
    if (await this.tableExists("project_details")) {
      await this.dropTable("project_details")
    }
  }
}
