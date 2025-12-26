/**
 * Run a query using the native SQLite async API.
 * @param {import("sqlite3").Database & {getAllAsync: (sql: string) => Promise<Record<string, unknown>[]>}} connection - SQLite connection instance.
 * @param {string} sql - SQL string to execute.
 * @returns {Promise<Record<string, unknown>[]>} - Resolves with the result rows.
 */
export default async function query(connection, sql) {
  const rows = []
  let result

  try {
    result = await connection.getAllAsync(sql)
  } catch (error) {
    let sqlInErrorMessage = `${sql}`

    if (sqlInErrorMessage.length >= 4096) {
      sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`
    }

    error.message += `\n\n${sqlInErrorMessage}`

    // Re-throw to recover stack trace
    throw new Error(error.message)
  }

  for await (const entry of result) {
    rows.push(entry)
  }

  return rows
}
