import "../../../../src/utils/with-tracked-stack-async-hooks.js"
import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../dummy-directory.js"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../../../src/database/initializer-from-require-context.js"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import path from "path"
import requireContext from "require-context"
import TestWebsocketChannel from "../channels/test-websocket-channel.js"

const queryParam = (request, key) => {
  const pathValue = request?.path?.()
  const query = pathValue?.split("?")[1]

  if (!query) return

  return new URLSearchParams(query).get(key) || undefined
}

export default new Configuration({
  database: {
    test: {
      default: {
        driver: MysqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mysql",
        host: "mariadb",
        username: "peakflow",
        password: "password",
        database: "velocious_test",
        useDatabase: "velocious_test",
        migrations: true
      },
      mssql: {
        driver: MssqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "mssql",
        database: "velocious_test",
        useDatabase: "default",
        migrations: true,
        sqlConfig: {
          user: "sa",
          password: "Super-Secret-Password",
          database: "velocious_test",
          server: "mssql",
          options: {
            serverName: "mssql",
            encrypt: true, // for azure
            trustServerCertificate: true // change to true for local dev / self-signed certs
          }
        }
      }
    }
  },
  directory: dummyDirectory(),
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
  websocketChannelResolver: ({request}) => {
    const channel = queryParam(request, "channel")

    if (channel === "test") return TestWebsocketChannel
  }
})
