/**
 * Connect a MSSQL connection instance.
 * @param {import("mssql").Connection} connection - MSSQL connection instance.
 * @returns {Promise<void>} - Resolves when the connection is established.
 */
export default function connectConnection(connection) {
  return new Promise((resolve, reject) => {
    connection.connect((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
