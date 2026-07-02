// @ts-check

import Migration from "../../../../../src/database/migration/index.js"

export default class CreateSyncEntries extends Migration {
  async change() {
    await this.createTable("sync_entries", {id: {type: "bigint"}}, (table) => {
      table.string("authentication_token_id", {index: true, null: true})
      table.string("resource_id", {index: true, null: false})
      table.string("resource_type", {index: true, null: false})
      table.string("sync_type", {null: false})
      table.datetime("client_updated_at", {null: true})
      table.text("data", {null: true})
      table.integer("server_sequence", {index: true, null: true})
      table.timestamps()
    })
  }

  async down() {
    await this.dropTable("sync_entries")
  }
}
