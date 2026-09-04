// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelWebsocketChannel from "../../src/frontend-models/websocket-channel.js"
import PgsqlColumn from "../../src/database/drivers/pgsql/column.js"

describe("FrontendModelWebsocketChannel", {databaseCleaning: {transaction: true}}, () => {
  it("exposes websocket metadata separately from upgrade request headers", () => {
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task"},
      session: /** @type {any} */ ({
        getMetadata: () => ({
          cookie: "session=metadata-token",
          origin: "https://metadata.example",
          "X-Session-Token": "metadata-token",
          locale: "da"
        }),
        upgradeRequest: {
          headers: () => ({
            Cookie: "session=upgrade-token",
            Origin: "https://upgrade.example",
            "X-Session-Token": "upgrade-token"
          }),
          remoteAddress: () => "127.0.0.1"
        }
      }),
      subscriptionId: "test-subscription"
    })

    const request = channel._syntheticRequest()

    expect(request.header("cookie")).toEqual("session=upgrade-token")
    expect(request.header("origin")).toEqual("https://upgrade.example")
    expect(request.header("x-session-token")).toEqual("upgrade-token")
    expect(request.header("locale")).toEqual(undefined)
    expect(request.metadata()).toEqual({
      cookie: "session=metadata-token",
      origin: "https://metadata.example",
      "X-Session-Token": "metadata-token",
      locale: "da"
    })
    expect(request.metadata("locale")).toEqual("da")
    expect(request.metadata("X-Session-Token")).toEqual("metadata-token")
    expect(request.origin()).toEqual("https://upgrade.example")
    expect(request.remoteAddress()).toEqual("127.0.0.1")
  })

  it("keeps metadata-only values out of synthetic headers", () => {
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task"},
      session: /** @type {any} */ ({
        getMetadata: () => ({
          "X-Session-Token": "metadata-token"
        }),
        upgradeRequest: {
          headers: () => ({
            Cookie: "session=upgrade-token"
          })
        }
      }),
      subscriptionId: "test-subscription"
    })

    const request = channel._syntheticRequest()

    expect(request.header("cookie")).toEqual("session=upgrade-token")
    expect(request.header("x-session-token")).toEqual(undefined)
    expect(request.metadata("X-Session-Token")).toEqual("metadata-token")
  })

  it("exposes debug-safe subscription details", () => {
    const channel = new FrontendModelWebsocketChannel({
      params: {
        eventFilters: [
          {key: "paid", where: {state: "paid"}}
        ],
        model: "Invoice",
        preload: {organization: true},
        select: {Invoice: ["id", "state"]},
        unfilteredEventDelivery: true
      },
      session: /** @type {any} */ ({}),
      subscriptionId: "debug-subscription"
    })

    expect(channel.debugSnapshot()).toEqual({
      abilities: false,
      destroyEventDelivery: false,
      eventFilterCount: 1,
      model: "Invoice",
      preload: true,
      queryData: false,
      select: true,
      selectsExtra: false,
      unfilteredEventDelivery: true,
      withCount: false
    })
  })

  it("skips projected lifecycle events when the record cannot be reloaded", async () => {
    /** @type {Array<{body?: object, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task", select: {Task: ["id", "name"]}},
      // @ts-expect-error Minimal sendJson-only session stub for direct channel delivery.
      session: {
        sendJson: (/** @type {{body?: object, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "projected-missing-record"
    })

    channel._projectedRecordForEventId = async () => null

    await channel.deliverBroadcast({
      action: "update",
      id: "missing-task",
      record: {id: "missing-task", name: "Raw fallback"}
    })

    expect(sentFrames).toEqual([])
  })

  it("delivers destroy events without unfiltering create or update events", async () => {
    /** @type {Array<{body?: object, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {
        destroyEventDelivery: true,
        eventFilters: [
          {key: "done", where: {state: "done"}}
        ],
        model: "Task"
      },
      // @ts-expect-error Minimal sendJson-only session stub for direct channel delivery.
      session: {
        sendJson: (/** @type {{body?: object, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "filtered-destroy-delivery"
    })

    channel._frontendModelControllerClass = async () => /** @type {typeof import("../../src/frontend-model-controller.js").default} */ (class FrontendModelController {})
    channel._destroyEventIsAuthorized = async () => true
    channel._matchedEventFilterKeysForEventId = async () => []

    await channel.deliverBroadcast({
      action: "update",
      id: "other-task",
      record: {id: "other-task", state: "open"}
    })
    await channel.deliverBroadcast({
      action: "destroy",
      id: "destroyed-task"
    }, {
      broadcastParams: {destroyAuthorizationRecord: {id: "destroyed-task"}}
    })

    expect(sentFrames.map((frame) => frame.body)).toEqual([
      {
        action: "destroy",
        id: "destroyed-task"
      }
    ])
  })

  it("does not expose unauthorized destroy identities", async () => {
    /** @type {Array<{body?: object, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "CompositeTask"},
      // @ts-expect-error Minimal sendJson-only session stub for direct channel delivery.
      session: {
        sendJson: (/** @type {{body?: object, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "unauthorized-destroy-delivery"
    })

    channel._frontendModelControllerClass = async () => /** @type {typeof import("../../src/frontend-model-controller.js").default} */ (class FrontendModelController {})
    channel._destroyEventIsAuthorized = async () => false

    await channel.deliverBroadcast({
      action: "destroy",
      id: {externalId: "secret", tenantId: "tenant-b"}
    }, {
      broadcastParams: {destroyAuthorizationRecord: {external_id: "secret", tenant_id: "tenant-b"}}
    })

    expect(sentFrames).toEqual([])
  })

  it("does not deliver persisted broadcasts for another frontend model", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    /** @type {Array<{body?: object, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task"},
      // @ts-expect-error Minimal sendJson-only session stub for direct channel delivery.
      session: {
        sendJson: (/** @type {{body?: object, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "persisted-other-model"
    })

    channel._projectedRecordForEventId = async () => ({id: "project-1"})

    await channel.deliverBroadcast({
      action: "update",
      id: "project-1",
      model: "Project"
    })

    expect(sentFrames).toEqual([])
  })

  it("authorizes destroys against the captured row source and composite identity", async () => {
    const froms = ["records"]
    let appliedFrom
    let appliedWhere
    const query = {
      driver: {
        getType: () => "pgsql",
        quote: (/** @type {unknown} */ value) => `'${value}'`,
        quoteColumn: (/** @type {string} */ columnName) => `"${columnName}"`,
        quoteTable: (/** @type {string} */ tableName) => `"${tableName}"`
      },
      first: async () => ({authorized: true}),
      from: (/** @type {string} */ from) => {
        appliedFrom = from
        froms.push(from)
        return query
      },
      getFroms: () => froms,
      where: (/** @type {Record<string, unknown>} */ where) => {
        appliedWhere = where
        return query
      }
    }
    const pgsqlTable = {
      getDriver: () => query.driver
    }
    const ModelClass = class CompositeRecord {
      /** @returns {typeof query} - Fresh model query. */
      static _newQuery() { return query }

      /** @param {string} attributeName - Attribute name. @returns {string} - Database column. */
      static getColumnNameForAttributeName(attributeName) {
        return attributeName === "externalId" ? "external_id" : "tenant_id"
      }

      /** @returns {Record<string, import("../../src/database/drivers/base-column.js").default>} - Backing columns by name. */
      static getColumnsHash() {
        return {
          external_id: new PgsqlColumn(/** @type {any} */ (pgsqlTable), {column_comment: null, column_name: "external_id", data_type: "uuid"}),
          labels: new PgsqlColumn(/** @type {any} */ (pgsqlTable), {column_comment: null, column_name: "labels", data_type: "ARRAY", udt_name: "_text", udt_schema: "pg_catalog"}),
          priority: new PgsqlColumn(/** @type {any} */ (pgsqlTable), {column_comment: null, column_name: "priority", data_type: "integer", domain_name: "task_priority", domain_schema: "public"}),
          status: new PgsqlColumn(/** @type {any} */ (pgsqlTable), {column_comment: null, column_name: "status", data_type: "USER-DEFINED", udt_name: "task_status", udt_schema: "public"}),
          tenant_id: new PgsqlColumn(/** @type {any} */ (pgsqlTable), {column_comment: null, column_name: "tenant_id", data_type: "bigint"})
        }
      }

      /** @returns {string} - Backing table name. */
      static tableName() { return "records" }
    }
    const controller = {
      ensureFrontendModelClassInitialized: async () => {},
      frontendModelAuthorizedQuery: () => query,
      frontendModelClass: () => ModelClass,
      frontendModelPrimaryKey: () => ["tenantId", "externalId"]
    }
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "CompositeRecord"},
      // @ts-expect-error Minimal session stub for direct authorization.
      session: {},
      subscriptionId: "destroy-authorization-source"
    })

    channel._frontendModelController = () => /** @type {any} */ (controller)
    channel._withEventTenant = async (_id, callback) => await callback()

    const authorized = await channel._destroyEventIsAuthorized({
      action: "destroy",
      id: {externalId: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c", tenantId: 42}
    }, /** @type {typeof import("../../src/frontend-model-controller.js").default} */ (class FrontendModelController {}), {
      external_id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c",
      labels: ["urgent"],
      priority: 3,
      status: "open",
      tenant_id: 42
    })

    expect(authorized).toEqual(true)
    expect(froms).toEqual(["(SELECT CAST('7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c' AS uuid) AS \"external_id\", CAST(ARRAY['urgent'] AS \"pg_catalog\".\"_text\") AS \"labels\", CAST('3' AS \"public\".\"task_priority\") AS \"priority\", CAST('open' AS \"public\".\"task_status\") AS \"status\", CAST('42' AS bigint) AS \"tenant_id\") AS \"records\""])
    expect(appliedFrom).toEqual("(SELECT CAST('7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c' AS uuid) AS \"external_id\", CAST(ARRAY['urgent'] AS \"pg_catalog\".\"_text\") AS \"labels\", CAST('3' AS \"public\".\"task_priority\") AS \"priority\", CAST('open' AS \"public\".\"task_status\") AS \"status\", CAST('42' AS bigint) AS \"tenant_id\") AS \"records\"")
    expect(appliedWhere).toEqual({records: {external_id: "7f0a1b2c-3d4e-4f5a-8b6c-9d0e1f2a3b4c", tenant_id: 42}})
  })

  it("delivers filtered identity changes so instance listeners can rekey", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    /** @type {Array<{body?: Record<string, ReturnType<typeof JSON.parse>>, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {
        eventFilters: [
          {key: "open", where: {state: "open"}}
        ],
        model: "CompositeTask"
      },
      // @ts-expect-error Minimal session stub for direct channel delivery.
      session: {
        configuration: {
          getEnvironmentHandler: () => ({getTimeZone: () => "UTC"})
        },
        sendJson: (/** @type {{body?: Record<string, ReturnType<typeof JSON.parse>>, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "filtered-identity-change"
    })

    channel._frontendModelControllerClass = async () => /** @type {typeof import("../../src/frontend-model-controller.js").default} */ (class FrontendModelController {})
    channel._matchedEventFilterKeysForEventId = async () => []
    channel._projectedRecordForEventId = async () => ({
      name: "Renamed task",
      state: "closed",
      workspaceId: "alpha"
    })

    await channel.deliverBroadcast({
      action: "update",
      id: {name: "Renamed task", workspaceId: "alpha"},
      previousId: {name: "Original task", workspaceId: "alpha"}
    })

    expect(sentFrames.map((frame) => frame.body)).toEqual([
      {
        action: "update",
        id: {name: "Renamed task", workspaceId: "alpha"},
        matchedEventFilterKeys: [],
        previousId: {name: "Original task", workspaceId: "alpha"},
        record: {
          name: "Renamed task",
          state: "closed",
          workspaceId: "alpha"
        }
      }
    ])
  })

  it("delivers identity-only routing when a re-keyed record is no longer authorized", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    /** @type {Array<{body?: Record<string, ReturnType<typeof JSON.parse>>, type?: string}>} */
    const sentFrames = []
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "CompositeTask"},
      // @ts-expect-error Minimal session stub for direct channel delivery.
      session: {
        sendJson: (/** @type {{body?: Record<string, ReturnType<typeof JSON.parse>>, type?: string}} */ frame) => sentFrames.push(frame)
      },
      subscriptionId: "unauthorized-identity-change"
    })

    channel._frontendModelControllerClass = async () => /** @type {typeof import("../../src/frontend-model-controller.js").default} */ (class FrontendModelController {})
    channel._projectedRecordForEventId = async () => null

    await channel.deliverBroadcast({
      action: "update",
      id: {name: "Renamed task", workspaceId: "beta"},
      previousId: {name: "Original task", workspaceId: "alpha"}
    })

    expect(sentFrames.map((frame) => frame.body)).toEqual([
      {
        action: "update",
        id: {name: "Renamed task", workspaceId: "beta"},
        previousId: {name: "Original task", workspaceId: "alpha"}
      }
    ])
  })

  it("does not hold a generic broadcast checkout while resolving tenant-scoped event access", async () => {
    /** @type {string[]} */
    const checkoutNames = []
    /** @type {Array<{body?: object, type?: string}>} */
    const sentFrames = []
    /** @type {string | null} */
    let activeCheckoutName = null
    const configuration = {
      ensureConnections: async (/** @type {{name: string}} */ options, /** @type {() => Promise<boolean | void>} */ callback) => {
        if (activeCheckoutName) {
          throw new Error(`Nested checkout ${options.name} while ${activeCheckoutName} is active`)
        }

        activeCheckoutName = options.name
        checkoutNames.push(options.name)

        try {
          return await callback()
        } finally {
          activeCheckoutName = null
        }
      },
      getEnvironmentHandler: () => ({getTimeZone: () => "UTC"}),
      resolveTenant: async () => {
        if (!activeCheckoutName) {
          throw new Error("Tenant resolution did not run inside a checkout")
        }

        return {slug: "alpha"}
      },
      runWithTenant: async (/** @type {{slug: string}} */ _tenant, /** @type {() => Promise<boolean | void>} */ callback) => await callback()
    }
    const channel = new FrontendModelWebsocketChannel({
      params: {model: "Task", project_slug: "alpha"},
      // @ts-expect-error Minimal session stub for direct channel delivery.
      session: {
        configuration,
        getMetadata: () => ({}),
        sendJson: (/** @type {{body?: object, type?: string}} */ frame) => sentFrames.push(frame),
        upgradeRequest: {
          headers: () => ({}),
          remoteAddress: () => "127.0.0.1"
        }
      },
      subscriptionId: "tenant-access-checkout"
    })

    channel._frontendModelControllerClass = async () => /** @type {typeof import("../../src/frontend-model-controller.js").default} */ (class FrontendModelController {})
    channel._projectedRecordForEventId = async (id) => {
      return await channel._withEventTenant(id, async () => ({id: "task-1", name: "Task 1"}))
    }

    await channel.deliverBroadcast({
      action: "update",
      id: "task-1",
      record: {id: "task-1", name: "Task 1"}
    })

    expect(checkoutNames).toEqual([
      "Frontend model websocket event tenant resolution",
      "Frontend model websocket event tenant"
    ])
    expect(sentFrames.map((frame) => frame.body)).toEqual([
      {
        action: "update",
        id: "task-1",
        record: {
          id: "task-1",
          name: "Task 1"
        }
      }
    ])
  })

  it("forwards the subscriber's auth params to resolveAbility", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const resolveAbilityParams = []
    const abilityStub = {
      loadAbilitiesForModelClass: () => {},
      rulesFor: () => [{effect: "allow"}]
    }
    const configuration = {
      getBackendProjects: () => [],
      getModelClasses: () => ({Task: class Task {}}),
      resolveAbility: async (/** @type {{params: Record<string, unknown>}} */ {params}) => {
        resolveAbilityParams.push(params)

        return abilityStub
      }
    }
    const channel = new FrontendModelWebsocketChannel({
      params: {authenticationToken: "token-123", model: "Task"},
      session: /** @type {any} */ ({
        configuration,
        getMetadata: () => ({}),
        upgradeRequest: {
          headers: () => ({}),
          remoteAddress: () => "127.0.0.1"
        }
      }),
      subscriptionId: "auth-forwarding"
    })

    const allowed = await channel.canSubscribe()

    expect(allowed).toEqual(true)
    expect(resolveAbilityParams.length).toEqual(1)
    expect(resolveAbilityParams[0].authenticationToken).toEqual("token-123")
    expect(resolveAbilityParams[0].model).toEqual("Task")
  })
})
