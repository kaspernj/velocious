// @ts-check

import Migration from "../../../../../src/database/migration/index.js"

export default class CreateActsAsListItems extends Migration {
  async change() {
    await this.createTable("acts_as_list_items", {ifNotExists: true}, (table) => {
      table.references("project", {null: false})
      table.integer("position", {null: true})
      table.string("name")
      table.timestamps()
    })

    await this.addIndex("acts_as_list_items", ["project_id", "position"], {ifNotExists: true, unique: true})
  }

  async down() {
    await this.dropTable("acts_as_list_items")
  }
}
