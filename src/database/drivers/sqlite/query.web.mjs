export default async function query(connection, sql) {
  const rows = []
  let result

  try {
    result = connection.exec(sql)
  } catch (error) {
    error.message += `\n\n${sql}`

    throw error
  }

  if (result[0]) {
    const columns = result[0].columns

    for (const rowValues of result[0].values) {
      const row = {}

      for (const columnIndex in columns) {
        row[columns[columnIndex]] = rowValues[columnIndex]
      }

      rows.push(row)
    }
  }

  return rows
}
