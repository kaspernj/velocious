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

    throw error
  }

  for await (const entry of result) {
    rows.push(entry)
  }

  return rows
}
