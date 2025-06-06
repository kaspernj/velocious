import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.mjs"
import Configuration from "../../../../src/configuration.mjs"
import dummyDirectory from "../../dummy-directory.mjs"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../../../src/database/initializer-from-require-context.mjs"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.mjs"
import path from "path"
import requireContext from "require-context"

export default new Configuration({
  database: {
    default: {
      master: {
        driver: MysqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mysql",
        host: "mariadb",
        username: "peakflow",
        password: "password",
        database: "velocious_test",
        useDatabase: "velocious_test"
      }
    }
  },
  directory: dummyDirectory(),
  initializeModels: async ({configuration}) => {
    const modelsPath = await fs.realpath(`${path.dirname(import.meta.dirname)}/../src/models`)
    const requireContextModels = requireContext(modelsPath, true, /^(.+)\.mjs$/)
    const initializerFromRequireContext = new InitializerFromRequireContext({requireContext: requireContextModels})

    await configuration.getDatabasePool().withConnection(async () => {
      await initializerFromRequireContext.initialize({configuration})
    })
  },
  locale: () => "en",
  locales: ["de", "en"]
})
