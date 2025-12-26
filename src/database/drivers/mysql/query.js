/**
 * @param {import("mysql").Pool} pool
 * @param {string} sql
 * @returns {Promise<Record<string, any>[]>} - Resolves with string value.
 */
export default async function query(pool, sql) {
  return new Promise((resolve, reject) => {
    pool.query(sql, (error, results, fields) => {
      if (error) {
        reject(new Error(`Query failed because of ${error}: ${sql}`))
      } else {
        const rows = []

        for (const resultIndex in results) {
          /** @type {Record<string, any>} */
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
