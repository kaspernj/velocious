// @ts-check

/**
 * Runs query.
 * @param {import("sqlite3").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, ?>[]>} - Resolves with string value.
 */
export default async function query(connection, sql) {
  try {
    /**
     * Defines result.
     * @type {Record<string, ?>[]} */
    let result

    // @ts-expect-error
    result = await connection.all(sql)

    return result
  } catch (error) {
    let sqlInErrorMessage = `${sql}`

    if (sqlInErrorMessage.length >= 4096) {
      sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`
    }

    if (error instanceof Error) {
      error.message += `\n\n${sqlInErrorMessage}`

      throw new Error(error.message, {cause: error})
    } else {
      throw new Error(`An error occurred: ${error}\n\n${sql}`, {cause: error})
    }
  }
}
