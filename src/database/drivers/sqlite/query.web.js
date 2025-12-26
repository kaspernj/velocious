// @ts-check

/**
 * @param {import("sql.js").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, unknown>[]>} - Resolves with string value.
 */
export default async function query(connection, sql) {
  const rows = []
  let result

  try {
    result = connection.exec(sql)
  } catch (error) {
    let sqlInErrorMessage = `${sql}`

    if (sqlInErrorMessage.length >= 4096) {
      sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`
    }

    if (error instanceof Error) {
      error.message += `\n\n${sqlInErrorMessage}`
    } else {
      throw new Error(`An error occurred: ${error} [${typeof error}]\n\n${sqlInErrorMessage}`)
    }

    throw error
  }

  if (result[0]) {
    const columns = result[0].columns

    for (const rowValues of result[0].values) {
      /** @type {Record<string, unknown>} */
      const row = {}

      for (const columnIndex in columns) {
        row[columns[columnIndex]] = rowValues[columnIndex]
      }

      rows.push(row)
    }
  }

  return rows
}
