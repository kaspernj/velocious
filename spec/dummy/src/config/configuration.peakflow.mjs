export {databaseConfiguration}

import Configuration from "../../../src/configuration.mjs"

const directory = `${process.cwd()}/spec/dummy`

const configuration = new Configuration({
  database: {
    default: {
      master: {
        type: "mysql",
        host: "mariadb",
        username: "peakflow",
        password: "password",
        database: "velocious_test"
      }
    }
  },
  directory
})

export default configuration
