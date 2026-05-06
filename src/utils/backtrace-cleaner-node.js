// @ts-check

import BacktraceCleaner from "./backtrace-cleaner.js"

/**
 * @param {string | undefined} value - Path or file URL.
 * @returns {string | undefined} - Normalized path.
 */
function normalizePath(value) {
  if (!value) return undefined

  let normalized = value

  if (normalized.startsWith("file://")) {
    try {
      normalized = new URL(normalized).pathname
    } catch {
      // Keep original value when URL parsing fails.
    }
  }

  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // Keep encoded value when decoding fails.
  }

  return normalized.replace(/\\/g, "/")
}

/**
 * @returns {string | undefined} - The Velocious source directory for Node runtimes.
 */
function frameworkSourceDirectory() {
  try {
    const sourceUrl = new URL("../", import.meta.url)

    if (sourceUrl.protocol !== "file:") return undefined

    return normalizePath(sourceUrl.pathname)
  } catch {
    return undefined
  }
}

export const FRAMEWORK_SOURCE_DIRECTORY = frameworkSourceDirectory()

export default class NodeBacktraceCleaner extends BacktraceCleaner {
  /**
   * @param {Error} error - Error instance.
   * @param {object} [args] - Options object.
   * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
   * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
   * @returns {string | undefined} - The cleaned stack.
   */
  static getCleanedStack(error, args) {
    return new NodeBacktraceCleaner(error, args).getCleanedStack(args)
  }

  /**
   * @param {Error} error - Error instance.
   * @param {object} args - Options object.
   * @param {string} args.applicationDirectory - Application directory.
   * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
   * @returns {string | undefined} - Source line for the first application frame.
   */
  static getApplicationSourceLine(error, args) {
    return new NodeBacktraceCleaner(error, args).getApplicationSourceLine(args)
  }

  /**
   * @param {Error} error - Error instance.
   * @param {object} [args] - Options object.
   * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
   */
  constructor(error, args = {}) {
    super(error, {
      ...args,
      frameworkSourceDirectory: args.frameworkSourceDirectory || FRAMEWORK_SOURCE_DIRECTORY
    })
  }
}
