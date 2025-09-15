export default async function query(connection, sql) {
  let result

  try {
    result = await connection.all(sql)
  } catch (error) {
    let sqlInErrorMessage = `${sql}`

    if (sqlInErrorMessage.length >= 4096) {
      sqlInErrorMessage = `${sqlInErrorMessage.substring(0, 4096)}...`
    }

    error.message += `\n\n${sqlInErrorMessage}`

    throw error
  }

  return result
}
