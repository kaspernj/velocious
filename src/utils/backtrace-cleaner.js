// @ts-check

/**
 * @param {string} value - Value to escape.
 * @returns {string} - Escaped value for a RegExp pattern.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * @typedef {object} ParsedStackFrame
 * @property {string | undefined} methodName - Method/function name from the stack frame.
 * @property {string} sourcePath - File or URL path from the stack frame.
 * @property {number} lineNumber - Source line number.
 * @property {number | undefined} columnNumber - Source column number.
 */

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
 * @param {string | undefined} value - Directory path.
 * @returns {string | undefined} - Normalized directory path ending with slash.
 */
function normalizeDirectory(value) {
  const normalized = normalizePath(value)

  if (!normalized) return undefined

  return normalized.endsWith("/") ? normalized : `${normalized}/`
}

/**
 * @param {string} line - Stack line.
 * @returns {ParsedStackFrame | undefined} - Parsed frame when possible.
 */
function parseStackFrame(line) {
  const trimmed = line.trim()

  if (!trimmed.startsWith("at ")) return undefined

  const frame = trimmed.slice(3)
  const frameWithMethodMatch = frame.match(/^(.*?) \((.*)\)$/)
  const methodName = frameWithMethodMatch ? frameWithMethodMatch[1] : undefined
  const location = frameWithMethodMatch ? frameWithMethodMatch[2] : frame
  const locationMatch = location.match(/^(.*):(\d+):(\d+)$/) || location.match(/^(.*):(\d+)$/)

  if (!locationMatch) return undefined

  const sourcePath = normalizePath(locationMatch[1])
  const lineNumber = Number(locationMatch[2])
  const columnNumber = locationMatch[3] === undefined ? undefined : Number(locationMatch[3])

  if (!sourcePath || !Number.isFinite(lineNumber)) return undefined

  return {
    columnNumber: Number.isFinite(columnNumber) ? columnNumber : undefined,
    lineNumber,
    methodName,
    sourcePath
  }
}

/**
 * @param {string} sourcePath - Source path.
 * @param {string} applicationDirectory - Application directory.
 * @returns {string} - Path relative to the application directory when possible.
 */
function relativeApplicationPath(sourcePath, applicationDirectory) {
  if (sourcePath.startsWith(applicationDirectory)) {
    return sourcePath.slice(applicationDirectory.length)
  }

  return sourcePath
}

export default class BacktraceCleaner {
  /** @type {string | undefined} */
  frameworkSourceDirectory = undefined

  /**
   * @param {Error} error - Error instance.
   * @param {object} [args] - Options object.
   * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
   * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
   * @returns {string | undefined} - The cleaned stack.
   */
  static getCleanedStack(error, args) {
    return new BacktraceCleaner(error, args).getCleanedStack(args)
  }

  /**
   * @param {Error} error - Error instance.
   * @param {object} args - Options object.
   * @param {string} args.applicationDirectory - Application directory.
   * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
   * @returns {string | undefined} - Source line for the first application frame.
   */
  static getApplicationSourceLine(error, args) {
    return new BacktraceCleaner(error, args).getApplicationSourceLine(args)
  }

  /**
   * @param {Error} error - Error instance.
   * @param {object} [args] - Options object.
   * @param {string | undefined} [args.frameworkSourceDirectory] - Directory for Velocious internals to skip.
   */
  constructor(error, {frameworkSourceDirectory} = {}) {
    this.error = error
    this.frameworkSourceDirectory = normalizeDirectory(frameworkSourceDirectory)
  }

  /**
   * @param {object} [args] - Options object.
   * @param {boolean} [args.includeErrorHeader] - Whether to include the `Error: ...` header line.
   * @returns {string | undefined} - The cleaned stack.
   */
  getCleanedStack({includeErrorHeader = true} = {}) {
    const backtrace = this.getCleanedStackLines()

    if (!backtrace || backtrace.length === 0) return undefined

    if (includeErrorHeader) return backtrace.join("\n")

    const firstLine = backtrace[0]
    const remainingLines = this.isErrorHeaderLine(firstLine) ? backtrace.slice(1) : backtrace

    if (remainingLines.length === 0) return undefined

    return remainingLines.join("\n")
  }

  /**
   * @returns {string[] | undefined} - Filtered stack lines.
   */
  getCleanedStackLines() {
    const backtrace = this.error?.stack?.split("\n")

    return backtrace?.filter((line) => this._shouldKeepStackLine(line))
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.applicationDirectory - Application directory.
   * @returns {string | undefined} - Source line for the first application frame.
   */
  getApplicationSourceLine({applicationDirectory}) {
    const normalizedApplicationDirectory = normalizeDirectory(applicationDirectory)

    if (!normalizedApplicationDirectory) return undefined

    const frame = this._firstApplicationFrame(normalizedApplicationDirectory)

    if (!frame) return undefined

    const relativePath = relativeApplicationPath(frame.sourcePath, normalizedApplicationDirectory)
    const methodSuffix = frame.methodName ? `:in ${frame.methodName.replace(/^async /, "")}` : ""

    return `${relativePath}:${frame.lineNumber}${methodSuffix}`
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

    const errorNamePattern = new RegExp(`^${escapeRegExp(this.error.name)}(?:\\s*\\[[^\\]]+\\])?:`)

    return errorNamePattern.test(trimmedLine)
  }

  /**
   * @param {string} applicationDirectory - Normalized application directory.
   * @returns {ParsedStackFrame | undefined} - First app-owned frame.
   */
  _firstApplicationFrame(applicationDirectory) {
    const backtrace = this.getCleanedStackLines()

    if (!backtrace) return undefined

    for (const line of backtrace) {
      const frame = parseStackFrame(line)

      if (!frame) continue
      if (!frame.sourcePath.startsWith(applicationDirectory)) continue
      if (this._frameworkSourcePath(frame.sourcePath)) continue

      return frame
    }

    return undefined
  }

  /**
   * @param {string} sourcePath - Source path.
   * @returns {boolean} - Whether the path belongs to Velocious internals.
   */
  _frameworkSourcePath(sourcePath) {
    if (!this.frameworkSourceDirectory) return false

    return sourcePath.startsWith(this.frameworkSourceDirectory)
  }

  /**
   * @param {string} line - Stack line.
   * @returns {boolean} - Whether to keep the stack line.
   */
  _shouldKeepStackLine(line) {
    if (line.includes("node_modules")) return false
    if (line.includes("(node:internal/")) return false
    if (line.includes("(node:internal/process/")) return false
    if (line.trim().startsWith("at node:internal/")) return false

    return true
  }
}
