// Async function to connect a MS-SQL connection
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
