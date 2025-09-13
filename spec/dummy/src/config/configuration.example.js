import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../dummy-directory.js"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../../../src/database/initializer-from-require-context.js"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import path from "path"
import requireContext from "require-context"

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
        database: "velocious_development"
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
        database: "velocious_production"
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
        database: "velocious_test"
      }
    }
  },
  directory: dummyDirectory(),
  initializeModels: async ({configuration}) => {
    const modelsPath = await fs.realpath(`${path.dirname(import.meta.dirname)}/../src/models`)
    const requireContextModels = requireContext(modelsPath, true, /^(.+)\.js$/)
    const initializerFromRequireContext = new InitializerFromRequireContext({requireContext: requireContextModels})

    await configuration.ensureConnections(async () => {
      await initializerFromRequireContext.initialize({configuration})
    })
  },
  locale: () => "en",
  localeFallbacks: {
    de: ["de", "en"],
    en: ["en", "de"]
  },
  locales: ["de", "en"]
})
