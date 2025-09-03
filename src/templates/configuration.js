import AsyncTrackedMultiConnection from "velocious/src/database/pool/async-tracked-multi-connection.js"
import Configuration from "velocious/src/configuration.js"
import MysqlDriver from "velocious/src/database/drivers/mysql/index.js"

export default new Configuration({
  database: {
    development: {
      default: {
        driver: MysqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mysql",
        host: "mariadb",
        username: "username",
        password: "password",
        database: "database_development"
      }
    },
    production: {
      default: {
        driver: MysqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mysql",
        host: "mariadb",
        username: "username",
        password: "password",
        database: "database_production"
      }
    },
    test: {
      default: {
        driver: MysqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mysql",
        host: "mariadb",
        username: "username",
        password: "password",
        database: "database_test"
      }
    }
  },
  initializeModels: async ({configuration}) => {
    const modelsPath = await fs.realpath(`${path.dirname(import.meta.dirname)}/../src/models`)
    const requireContextModels = requireContext(modelsPath, true, /^(.+)\.js$/)
    const initializerFromRequireContext = new InitializerFromRequireContext({requireContext: requireContextModels})

    await configuration.getDatabasePool().withConnection(async () => {
      await initializerFromRequireContext.initialize({configuration})
    })
  },
  locale: () => "en",
  locales: ["de", "en"],
  localeFallbacks: {
    de: ["de", "en"],
    en: ["en", "de"]
  }
})
