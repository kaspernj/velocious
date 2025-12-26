// @ts-check

export default class BacktraceCleaner {
  /**
   * @param {Error} error
   * @returns {string | undefined} - The cleaned stack.
   */
  static getCleanedStack(error) {
    return new BacktraceCleaner(error).getCleanedStack()
  }

  /**
   * @param {Error} error
   */
  constructor(error) {
    this.error = error
  }

  /**
   * @returns {string | undefined} - The cleaned stack.
   */
  getCleanedStack() {
    const backtrace = this.error?.stack?.split("\n")

    return backtrace?.filter((line) => !line.includes("node_modules") && !line.includes("(node:internal/process/")).join("\n")
  }
}
