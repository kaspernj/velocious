// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelWebsocketChannel from "../../src/frontend-models/websocket-channel.js"

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
    channel._matchedEventFilterKeysForEventId = async () => []

    await channel.deliverBroadcast({
      action: "update",
      id: "other-task",
      record: {id: "other-task", state: "open"}
    })
    await channel.deliverBroadcast({
      action: "destroy",
      id: "destroyed-task"
    })

    expect(sentFrames.map((frame) => frame.body)).toEqual([
      {
        action: "destroy",
        id: "destroyed-task"
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
      resolveTenant: async () => ({slug: "alpha"}),
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
    channel._eventIsAccessible = async (id) => {
      return await channel._withEventTenant(id, async () => true)
    }

    await channel.deliverBroadcast({
      action: "update",
      id: "task-1",
      record: {id: "task-1", name: "Task 1"}
    })

    expect(checkoutNames).toEqual(["Frontend model websocket event tenant"])
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
