import Migration from "../../../../../src/database/migration/index.js"

export default class AddIsActiveToProjectDetails extends Migration {
  async change() {
    await this.addColumn("project_details", "is_active", "boolean")
  }

  async down() {
    await this.removeColumn("project_details", "is_active")
  }
}
