// @ts-check

/**
 * @param {import("sqlite3").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, any>[]>} - Resolves with string value.
 */
export default async function query(connection, sql) {
  try {
    /** @type {Record<string, any>[]} */
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

      throw new Error(error.message)
    } else {
      throw new Error(`An error occurred: ${error}\n\n${sql}`)
    }
  }
}

