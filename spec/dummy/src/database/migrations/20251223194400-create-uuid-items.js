import Migration from "../../../../../src/database/migration/index.js"

export default class CreateUuidItems extends Migration {
  async up() {
    if (!await this.tableExists("uuid_items")) {
      await this.createTable("uuid_items", {id: {type: "uuid"}}, (t) => {
        t.string("title")
        t.timestamps()
      })
    }
  }

  async down() {
    if (await this.tableExists("uuid_items")) {
      await this.dropTable("uuid_items")
    }
  }
}
