export default async function query(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error, results, fields) => {
      if (error) {
        reject(error)
      } else {
        const result = {}

        for (const fieldKey in fields) {
          const field = fields[fieldKey].name
          const value = results[0][field]

          result[field] = value
        }

        resolve(result)
      }
    })
  })
}
