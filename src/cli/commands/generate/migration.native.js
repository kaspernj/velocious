import BaseCommand from "../../base-command.js"

export default class DbGenerateMigration extends BaseCommand {
  async execute() {
    throw new Error("Unsupported on native")
  }
}
