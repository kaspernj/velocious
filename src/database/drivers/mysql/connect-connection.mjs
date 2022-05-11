// Async function to connect a MySQL connection
export default async function connectConnection(connection) {
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
