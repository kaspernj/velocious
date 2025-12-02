import BaseCommand from "../../base-command.js"

export default class DbDestroyMigration extends BaseCommand {
  async execute() {
    throw new Error("Unsupported on native")
  }
}
