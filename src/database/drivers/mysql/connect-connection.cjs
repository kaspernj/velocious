// Async function to connect a MySQL connection
module.exports = async function connectConnection(connection) {
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
