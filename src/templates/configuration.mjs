import {Configuration} from "velocious"

const configuration = new Configuration({
  database: {
    default: {
      master: {
        type: "mysql",
        host: "mariadb",
        username: "username",
        password: "password",
        database: "database"
      }
    }
  }
})

export default configuration
