export default class BacktraceCleaner {
  static getCleanedStack(error) {
    return new BacktraceCleaner(error).getCleanedStack()
  }

  constructor(error) {
    this.error = error
  }

  getCleanedStack() {
    const backtrace = this.error.stack.split("\n")

    return backtrace.filter((line) => !line.includes("node_modules") && !line.includes("(node:internal/process/")).join("\n")
  }
}
