const databaseConfiguration = () => {
  return {
    "default": {
      "master": {
        "type": "mysql",
        "host": "mysql",
        "username": "peakflow",
        "password": "password",
        "database": "velocious_test"
      }
    }
  }
}

module.exports = {databaseConfiguration}
