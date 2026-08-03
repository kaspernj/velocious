import Migration from "../../../../../src/database/migration/index.js"

export default class CreateTaskBoardsAndCards extends Migration {
  async change() {
    await this.createTable("task_boards", {id: {type: "bigint"}}, (table) => {
      table.references("project", {foreignKey: true, null: false, type: "bigint"})
      table.string("name", {null: false})
      table.timestamps()
    })

    await this.createTable("task_board_cards", {id: {type: "bigint"}}, (table) => {
      table.references("task_board", {foreignKey: true, null: false, type: "bigint"})
      table.references("task", {foreignKey: true, index: {unique: true}, null: false, type: "bigint"})
      table.string("board_column_id", {null: false})
      table.integer("position", {null: false})
      table.timestamps()
    })

    await this.addIndex("task_board_cards", ["task_board_id", "board_column_id", "position"], {unique: true})
  }

  async down() {
    await this.dropTable("task_board_cards")
    await this.dropTable("task_boards")
  }
}
