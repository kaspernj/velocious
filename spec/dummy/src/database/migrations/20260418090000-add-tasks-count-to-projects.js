import Migration from "../../../../../src/database/migration/index.js"

export default class AddTasksCountToProjects extends Migration {
  async change() {
    await this.addColumn("projects", "tasks_count", "integer", {null: false, default: 0})
  }

  async down() {
    await this.removeColumn("projects", "tasks_count")
  }
}
