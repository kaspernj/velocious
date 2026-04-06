import "../../../../src/utils/with-tracked-stack-async-hooks.js"
import Ability from "../../../../src/authorization/ability.js"
import AsyncTrackedMultiConnection from "../../../../src/database/pool/async-tracked-multi-connection.js"
import backendProjects from "./backend-projects.js"
import BaseResource from "../../../../src/authorization/base-resource.js"
import Configuration from "../../../../src/configuration.js"
import FilesystemAttachmentStorageDriver from "../../../../src/database/record/attachments/storage-drivers/filesystem.js"
import dummyDirectory from "../../dummy-directory.js"
import fs from "fs/promises"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import installSqlJsWasmRoute from "../../../../src/plugins/sqljs-wasm-route.js"
import SqliteDriver from "../../../../src/database/drivers/sqlite/index.js"
import path from "path"
import requireContext from "require-context"
import SingleMultiUsePool from "../../../../src/database/pool/single-multi-use.js"
import Comment from "../models/comment.js"
import Project from "../models/project.js"
import Task from "../models/task.js"
import TestWebsocketChannel from "../channels/test-websocket-channel.js"
import User from "../models/user.js"

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
    const applyReadDistinctScope = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_READ_DISTINCT_SCOPE === "1"
    const applySubqueryScope = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_SUBQUERY_SCOPE

    if (applyReadDistinctScope) {
      this.can(["destroy", "update"])
      this.can("read", (query) => query.distinct(true))
    } else if (applySubqueryScope) {
      this.can(["create", "destroy", "read", "update"], (query) => {
        query.where(`tasks.project_id IN (SELECT projects.id FROM projects WHERE projects.creating_user_reference = ${query.driver.quote(applySubqueryScope)})`)
      })
    } else {
      this.can(["destroy", "read", "update"])
    }

    const deniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

    if (deniedAction === "destroy" || deniedAction === "read" || deniedAction === "update") {
      this.cannot(deniedAction)
    }
  }
}

class UserFrontendModelAbilityResource extends BaseResource {
  static ModelClass = User

  /** @returns {void} */
  abilities() {
    this.can(["read"])
  }
}

class ProjectFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Project

  /** @returns {void} */
  abilities() {
    this.can(["read"])
  }
}

class CommentFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Comment

  /** @returns {void} */
  abilities() {
    this.can(["read"])
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
  const requestPath = request.path().split("?")[0]
  const isFrontendModelCommand = requestPath.startsWith("/api/frontend-models/")
  const isSharedFrontendModelApi = requestPath === "/velocious/api" || requestPath === "/frontend-models" || requestPath === "/frontend-models/request"
  const frontendModelRequests = Array.isArray(params.requests) ? params.requests : [params]
  const includesFrontendModelRequest = frontendModelRequests.some((requestEntry) => typeof requestEntry?.model === "string")

  if (!isFrontendModelCommand && !(isSharedFrontendModelApi && includesFrontendModelRequest)) return

  return new Ability({
    context: {configuration, params, request, response},
    resources: [TaskFrontendModelAbilityResource, UserFrontendModelAbilityResource, ProjectFrontendModelAbilityResource, CommentFrontendModelAbilityResource]
  })
}

const configuration = new Configuration({
  attachments: {
    defaultDriver: "filesystem",
    drivers: {
      filesystem: {
        driverClass: FilesystemAttachmentStorageDriver
      }
    }
  },
  abilityResolver: resolveTaskFrontendModelAbility,
  backendProjects,
  database: {
    test: {
      default: {
        driver: SqliteDriver,
        poolType: SingleMultiUsePool,
        type: "sqlite",
        name: "test-db",
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

    await configuration.ensureConnections(async (dbs) => {
      const db = dbs.default

      for (const fileName of requireContextModels.keys()) {
        const modelClassImport = requireContextModels(fileName)
        const modelClass = modelClassImport?.default

        if (!modelClass?.initializeRecord) continue

        if (typeof modelClass.getDatabaseIdentifier === "function" && modelClass.getDatabaseIdentifier() !== "default") {
          continue
        }

        const tableName = modelClass.tableName()

        if (!db || !await db.tableExists(tableName)) continue

        await modelClass.initializeRecord({configuration})

        if (await modelClass.hasTranslationsTable()) {
          const translationClass = modelClass.getTranslationClass()
          const translationTableName = translationClass.tableName()

          if (db && await db.tableExists(translationTableName)) {
            await translationClass.initializeRecord({configuration})
          }
        }
      }
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
