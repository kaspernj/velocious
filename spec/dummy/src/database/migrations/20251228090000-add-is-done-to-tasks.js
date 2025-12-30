import Migration from "../../../../../src/database/migration/index.js"

export default class AddIsDoneToTasks extends Migration {
  async change() {
    await this.addColumn("tasks", "is_done", "boolean")
  }
}
