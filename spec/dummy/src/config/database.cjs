const databaseConfiguration = () => {
  return {
    "default": {
      "master": {
        "type": "mysql",
        "host": "mysql",
        "username": "username",
        "password": "password",
        "database": "velocious_test"
      }
    }
  }
}

module.exports = {databaseConfiguration}
