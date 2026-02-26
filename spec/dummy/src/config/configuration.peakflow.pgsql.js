import "../../../../src/utils/with-tracked-stack-async-hooks.js"
import Ability from "../../../../src/authorization/ability.js"
import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.js"
import backendProjects from "./backend-projects.js"
import BaseResource from "../../../../src/authorization/base-resource.js"
import Configuration from "../../../../src/configuration.js"
import dummyDirectory from "../../dummy-directory.js"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../../../src/database/initializer-from-require-context.js"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import path from "path"
import PgsqlDriver from "../../../../src/database/drivers/pgsql/index.js"
import installSqlJsWasmRoute from "../../../../src/plugins/sqljs-wasm-route.js"
import requireContext from "require-context"
import Task from "../models/task.js"
import TestWebsocketChannel from "../channels/test-websocket-channel.js"

const queryParam = (request, key) => {
  const pathValue = request?.path?.()
  const query = pathValue?.split("?")[1]

  if (!query) return

  return new URLSearchParams(query).get(key) || undefined
}

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

class TaskFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Task

  /** @returns {void} */
  abilities() {
    this.can(["destroy", "read", "update"], Task)

    const deniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

    if (deniedAction === "destroy" || deniedAction === "read" || deniedAction === "update") {
      this.cannot(deniedAction, Task)
    }
  }
}

/**
 * @param {object} args - Ability resolver args.
 * @param {Record<string, any>} args.params - Request params.
 * @param {import("../../../../src/http-server/client/request.js").default | import("../../../../src/http-server/client/websocket-request.js").default} args.request - Request object.
 * @param {import("../../../../src/http-server/client/response.js").default} args.response - Response object.
 * @param {import("../../../../src/configuration.js").default} args.configuration - Configuration object.
 * @returns {Ability | undefined}
 */
function resolveTaskFrontendModelAbility({configuration, params, request, response}) {
  const deniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION
  if (!deniedAction) return

  const requestPath = request.path().split("?")[0]
  const isTaskFrontendModelCommand = requestPath.startsWith("/api/frontend-models/tasks/")

  if (!isTaskFrontendModelCommand) return

  return new Ability({
    context: {configuration, params, request, response},
    resources: [TaskFrontendModelAbilityResource]
  })
}

const configuration = new Configuration({
  abilityResolver: resolveTaskFrontendModelAbility,
  backendProjects,
  database: {
    test: {
      default: {
        driver: PgsqlDriver,
        poolType: AsyncTrackedMultiConnection,
        type: "pgsql",
        host: "postgres",
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
  cookieSecret: "dummy-cookie-secret",
  directory: dummyDirectory(),
  environmentHandler: new NodeEnvironmentHandler(),
  initializeModels: async ({configuration}) => {
    if (process.env.VELOCIOUS_SKIP_DUMMY_MODEL_INITIALIZATION === "1") return

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
  websocketMessageHandlerResolver,
  websocketChannelResolver: ({request, subscription}) => {
    const channel = subscription?.channel || queryParam(request, "channel")

    if (channel === "test") return TestWebsocketChannel
  }
})

installSqlJsWasmRoute({configuration})

export default configuration
