import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../dummy-directory.js"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../../../src/database/initializer-from-require-context.js"
import SqliteDriver from "../../../../src/database/drivers/sqlite/index.js"
import path from "path"
import requireContext from "require-context"
import SingleMultiUsePool from "../../../../src/database/pool/single-multi-use.js"

export default new Configuration({
  database: {
    test: {
      default: {
        driver: SqliteDriver,
        poolType: SingleMultiUsePool,
        type: "sqlite",
        name: "test-db"
      }
    }
  },
  directory: dummyDirectory(),
  initializeModels: async ({configuration}) => {
    const modelsPath = await fs.realpath(`${path.dirname(import.meta.dirname)}/../src/models`)
    const requireContextModels = requireContext(modelsPath, true, /^(.+)\.js$/)
    const initializerFromRequireContext = new InitializerFromRequireContext({requireContext: requireContextModels})

    await configuration.withConnections(async () => {
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
