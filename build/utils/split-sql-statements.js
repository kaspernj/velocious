// @ts-check

/**
 * Splits structure SQL into executable statements while keeping semicolons inside strings, identifiers, and comments intact.
 * @param {string} sql - SQL string.
 * @returns {string[]} - SQL statements.
 */
export default function splitSqlStatements(sql) {
  /** @type {string[]} */
  const statements = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]
    const nextChar = sql[index + 1]
    const previousChar = sql[index - 1]

    current += char

    if (inLineComment) {
      if (char == "\n") inLineComment = false

      continue
    }

    if (inBlockComment) {
      if (previousChar == "*" && char == "/") inBlockComment = false

      continue
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char == "-" && nextChar == "-") {
        inLineComment = true
        continue
      }

      if (char == "/" && nextChar == "*") {
        inBlockComment = true
        continue
      }
    }

    if (char == "'" && !inDoubleQuote && !inBacktick && previousChar != "\\") {
      if (inSingleQuote && nextChar == "'") {
        current += nextChar
        index += 1
      } else {
        inSingleQuote = !inSingleQuote
      }
      continue
    }

    if (char == "\"" && !inSingleQuote && !inBacktick && previousChar != "\\") {
      if (inDoubleQuote && nextChar == "\"") {
        current += nextChar
        index += 1
      } else {
        inDoubleQuote = !inDoubleQuote
      }
      continue
    }

    if (char == "`" && !inSingleQuote && !inDoubleQuote && previousChar != "\\") {
      inBacktick = !inBacktick
      continue
    }

    if (char == ";" && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      const trimmed = current.trim()

      if (trimmed) statements.push(trimmed)

      current = ""
    }
  }

  const trimmed = current.trim()

  if (trimmed) statements.push(trimmed)

  return statements
}
