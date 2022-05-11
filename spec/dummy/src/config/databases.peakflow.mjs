const databaseConfiguration = () => {
  return {
    "default": {
      "master": {
        "type": "mysql",
        "host": "mariadb",
        "username": "peakflow",
        "password": "password",
        "database": "velocious_test"
      }
    }
  }
}

export default {databaseConfiguration}
