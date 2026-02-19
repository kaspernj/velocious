// @ts-check

export default class BacktraceCleaner {
  /**
   * @param {Error} error - Error instance.
   * @returns {string | undefined} - The cleaned stack.
   */
  static getCleanedStack(error) {
    return new BacktraceCleaner(error).getCleanedStack()
  }

  /**
   * @param {Error} error - Error instance.
   * @returns {string | undefined} - The cleaned backtrace.
   */
  static getCleanedBacktrace(error) {
    return new BacktraceCleaner(error).getCleanedBacktrace()
  }

  /**
   * @param {Error} error - Error instance.
   */
  constructor(error) {
    this.error = error
  }

  /**
   * @returns {string | undefined} - The cleaned stack.
   */
  getCleanedStack() {
    const backtrace = this.getCleanedStackLines()

    if (!backtrace || backtrace.length === 0) return undefined

    return backtrace.join("\n")
  }

  /**
   * @returns {string | undefined} - The cleaned backtrace without the error header line.
   */
  getCleanedBacktrace() {
    const backtrace = this.getCleanedStackLines()

    if (!backtrace || backtrace.length === 0) return undefined

    const firstLine = backtrace[0]
    const remainingLines = this.isErrorHeaderLine(firstLine) ? backtrace.slice(1) : backtrace.slice(0)

    if (remainingLines.length === 0) return undefined

    return remainingLines.join("\n")
  }

  /**
   * @returns {string[] | undefined} - Filtered stack lines.
   */
  getCleanedStackLines() {
    const backtrace = this.error?.stack?.split("\n")

    return backtrace?.filter((line) => !line.includes("node_modules") && !line.includes("(node:internal/process/"))
  }

  /**
   * @param {string | undefined} line - Backtrace line.
   * @returns {boolean} - True when the line is an error header.
   */
  isErrorHeaderLine(line) {
    if (!line) return false

    const trimmedLine = line.trim()

    if (!trimmedLine) return false

    if (trimmedLine.startsWith("Error:")) return true

    return trimmedLine.startsWith(`${this.error.name}:`)
  }
}
