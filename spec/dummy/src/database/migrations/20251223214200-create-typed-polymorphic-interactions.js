import Migration from "../../../../../src/database/migration/index.js"

export default class CreateTypedPolymorphicInteractions extends Migration {
  async up() {
    if (!await this.tableExists("string_subjects")) {
      await this.createTable("string_subjects", {id: {type: "string"}}, (table) => {
        table.string("name")
        table.timestamps()
      })
    }

    if (!await this.tableExists("string_subject_interactions")) {
      await this.createTable("string_subject_interactions", (table) => {
        table.references("subject", {null: false, polymorphic: true, type: "string"})
        table.string("kind")
        table.timestamps()
      })
    }

    if (!await this.tableExists("uuid_interactions")) {
      await this.createTable("uuid_interactions", (table) => {
        table.references("subject", {null: false, polymorphic: true, type: "uuid"})
        table.string("kind")
        table.timestamps()
      })
    }
  }

  async down() {
    if (await this.tableExists("uuid_interactions")) {
      await this.dropTable("uuid_interactions")
    }

    if (await this.tableExists("string_subject_interactions")) {
      await this.dropTable("string_subject_interactions")
    }

    if (await this.tableExists("string_subjects")) {
      await this.dropTable("string_subjects")
    }
  }
}
