import {Configuration} from "velocious"

const configuration = new Configuration({
  database: {
    default: {
      master: {
        type: "mysql",
        host: "mariadb",
        username: "username",
        password: "passowrd",
        database: "database"
      }
    }
  }
})

export default configuration
