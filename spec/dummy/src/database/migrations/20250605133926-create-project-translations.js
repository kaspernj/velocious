import Migration from "../../../../../src/database/migration/index.js"

export default class CreateProjectTranslations extends Migration {
  async up() {
    await this.createTable("project_translations", (t) => {
      t.references("project", {null: false})
      t.string("locale", {null: false})
      t.string("name")
      t.timestamps()
    })
  }

  async down() {
    await this.dropTable("project_translations")
  }
}
