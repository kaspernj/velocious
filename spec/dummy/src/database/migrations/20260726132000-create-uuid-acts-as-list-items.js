// @ts-check

import Migration from "../../../../../src/database/migration/index.js"

export default class CreateUuidActsAsListItems extends Migration {
  async change() {
    await this.createTable("uuid_acts_as_list_items", {id: {type: "uuid"}}, (table) => {
      table.integer("scope_id", {null: false})
      table.integer("position", {null: true})
      table.string("name")
      table.timestamps()
    })

    await this.addIndex("uuid_acts_as_list_items", ["scope_id", "position"], {unique: true})
  }

  async down() {
    await this.dropTable("uuid_acts_as_list_items")
  }
}
