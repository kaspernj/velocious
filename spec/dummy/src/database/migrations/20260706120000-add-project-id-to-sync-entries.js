// @ts-check

import Migration from "../../../../../src/database/migration/index.js"

export default class AddProjectIdToSyncEntries extends Migration {
  async change() {
    await this.addColumn("sync_entries", "project_id", "string", {null: true})
    await this.addIndex("sync_entries", ["project_id"])
  }

  async down() {
    await this.removeIndex("sync_entries", ["project_id"])
    await this.removeColumn("sync_entries", "project_id")
  }
}
