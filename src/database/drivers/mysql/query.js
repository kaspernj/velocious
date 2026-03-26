/**
 * @param {import("mysql").Pool} pool - Pool.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, any>[]>} - Resolves with string value.
 */
export default async function query(pool, sql) {
  return new Promise((resolve, reject) => {
    pool.query(sql, (error, results, fields) => {
      if (error) {
        reject(new Error(`Query failed because of ${error}: ${sql}`))
      } else {
        const rows = []
        const resultRows = Array.isArray(results) ? results : []
        const resultFields = Array.isArray(fields) ? fields : []

        for (const rowData of resultRows) {
          /** @type {Record<string, any>} */
          const result = {}

          for (const fieldData of resultFields) {
            const field = fieldData.name
            const value = rowData[field]

            result[field] = value
          }

          rows.push(result)
        }

        resolve(rows)
      }
    })
  })
}
