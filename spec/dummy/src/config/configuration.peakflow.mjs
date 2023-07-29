import Configuration from "../../../../src/configuration.mjs"
import dummyDirectory from "../../dummy-directory.mjs"

const configuration = new Configuration({
  database: {
    default: {
      master: {
        type: "mysql",
        host: "mariadb",
        username: "peakflow",
        password: "password",
        database: "velocious_test",
        useDatabase: "velocious_test"
      }
    }
  },
  directory: dummyDirectory()
})

export default configuration
