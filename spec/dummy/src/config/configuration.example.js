import "../../../../src/utils/with-tracked-stack-async-hooks.js"
import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../dummy-directory.js"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../../../src/database/initializer-from-require-context.js"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import path from "path"
import requireContext from "require-context"

async function websocketMessageHandlerResolver({request}) {
  if (!request) return

  const pathValue = request.path().split("?")[0]

  if (pathValue === "/raw-socket") {
    return {
      onOpen: ({session}) => {
        session.sendJson({type: "welcome"})
      },
      onMessage: ({message, session}) => {
        session.sendJson({type: "echo", payload: message})
      }
    }
  }

  if (pathValue === "/raw-async-socket") {
    await new Promise((resolve) => setTimeout(resolve, 10))

    return {
      onOpen: ({session}) => {
        session.sendJson({type: "welcome"})
      },
      onMessage: ({message, session}) => {
        session.sendJson({type: "echo", payload: message})
      }
    }
  }
}

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
        database: "velocious_development",
        migrations: true
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
        database: "velocious_production",
        migrations: true
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
        database: "velocious_test",
        migrations: true
      }
    }
  },
  cookieSecret: "dummy-cookie-secret",
  directory: dummyDirectory(),
  environment: "development",
  environmentHandler: new NodeEnvironmentHandler(),
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
  locales: ["de", "en"],
  testing: `${dummyDirectory()}/src/config/testing.js`,
  websocketMessageHandlerResolver
})
