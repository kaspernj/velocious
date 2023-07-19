const databaseConfiguration = () => {
  return {
    "default": {
      "master": {
        "type": "mysql",
        "host": "mariadb",
        "username": "username",
        "password": "password",
        "database": "velocious_test"
      }
    }
  }
}

export {databaseConfiguration}
