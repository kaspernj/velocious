import Configuration from "../../../src/configuration.mjs"

const directory = `${process.cwd()}/spec/dummy`

const configuration = new Configuration({
  database: {
    default: {
      "master": {
        "type": "mysql",
        "host": "mariadb",
        "username": "dev",
        "password": "Eid7Eip6iof2weive7yaeshe8eu2Nei4",
        "database": "development"
      }
    }
  },
  directory
})

export default configuration
