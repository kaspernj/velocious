export default async function query(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error, results, fields) => {
      if (error) {
        reject(new Error(`Query failed because of ${error}: ${sql}`))
      } else {
        const rows = []

        for (const resultIndex in results) {
          const result = {}

          for (const fieldKey in fields) {
            const field = fields[fieldKey].name
            const value = results[resultIndex][field]

            result[field] = value
          }

          rows.push(result)
        }

        resolve(rows)
      }
    })
  })
}
