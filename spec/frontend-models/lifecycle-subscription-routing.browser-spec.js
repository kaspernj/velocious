// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import {resetFrontendModelTransport} from "../helpers/frontend-model-test-helpers.js"

/**
 * @typedef {object} RecordedSubscription
 * @property {() => void} close - Closes the subscription.
 * @property {boolean} closed - Whether the subscription is closed.
 * @property {() => boolean} isClosed - Whether the subscription is closed.
 * @property {{onMessage: (body: ReturnType<typeof JSON.parse>) => void, params: {destroyEventDelivery?: boolean, eventFilters?: Array<{key: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>, model: string, workspaceId?: string}}} options - Subscription options.
 * @property {Promise<void>} ready - Subscription acknowledgement.
 * @property {number} resumeCount - Number of simulated reconnect resumes.
 */

/**
 * Builds a recording websocket client whose live handles survive reconnect.
 * @param {{rejectFirstWorkspaceId?: string}} [args] - Optional acknowledgement failure control.
 * @returns {{connect: () => Promise<void>, publishUpdate: (record: Record<string, ReturnType<typeof JSON.parse>>) => void, reconnect: () => void, subscriptions: RecordedSubscription[], subscribeChannel: (channel: string, options: RecordedSubscription["options"]) => RecordedSubscription}} - Recording client.
 */
function buildWebsocketClient({rejectFirstWorkspaceId} = {}) {
  let rejectionPending = rejectFirstWorkspaceId !== undefined
  const client = {
    connect: async () => {},
    publishUpdate: (record) => {
      for (const subscription of client.subscriptions) {
        if (subscription.closed) continue

        const matchedEventFilterKeys = (subscription.options.params.eventFilters || [])
          .filter(({where}) => Object.entries(where || {}).every(([key, value]) => record[key] === value))
          .map(({key}) => key)

        if (matchedEventFilterKeys.length === 0) continue

        subscription.options.onMessage({
          action: "update",
          id: record.id,
          matchedEventFilterKeys,
          record
        })
      }
    },
    reconnect: () => {
      for (const subscription of client.subscriptions) {
        if (!subscription.closed) subscription.resumeCount += 1
      }
    },
    /** @type {RecordedSubscription[]} */
    subscriptions: [],
    subscribeChannel: (_channel, options) => {
      const firstWorkspaceId = options.params.workspaceId || options.params.eventFilters?.[0]?.where?.workspaceId
      const rejectAcknowledgement = rejectionPending && firstWorkspaceId === rejectFirstWorkspaceId

      if (rejectAcknowledgement) rejectionPending = false

      /** @type {RecordedSubscription} */
      const subscription = {
        close: () => {
          subscription.closed = true
        },
        closed: false,
        isClosed: () => subscription.closed,
        options,
        ready: rejectAcknowledgement
          ? Promise.reject(new Error(`Subscription rejected for ${rejectFirstWorkspaceId}`))
          : Promise.resolve(),
        resumeCount: 0
      }

      client.subscriptions.push(subscription)

      return subscription
    }
  }

  return client
}

/**
 * Builds an isolated frontend model class for one test.
 * @returns {typeof FrontendModelBase} - Frontend model class.
 */
function buildRoutedTaskClass() {
  return class RoutedTask extends FrontendModelBase {
    /** @returns {{attributes: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() { return {attributes: ["id", "state", "workspaceId"], primaryKey: "id"} }

    /** @returns {string} - Task id. */
    id() { return this.readAttribute("id") }
  }
}

/**
 * Builds an isolated composite-identity frontend model class.
 * @param {{beforeUpdateResponse?: (record: Record<string, ReturnType<typeof JSON.parse>>) => void | Promise<void>}} [args] - Optional update-response hook.
 * @returns {typeof FrontendModelBase} - Frontend model class.
 */
function buildCompositeRoutedTaskClass({beforeUpdateResponse} = {}) {
  return class CompositeRoutedTask extends FrontendModelBase {
    /** @returns {import("../../src/frontend-models/base.js").FrontendModelResourceConfig} - Resource configuration. */
    static resourceConfig() {
      return {
        attributes: ["name", "workspaceId", "state"],
        commands: ["update"],
        primaryKey: ["name", "workspaceId"]
      }
    }

    /**
     * Returns the re-keyed record for the listener-routing save regression.
     * @param {string} commandType - Frontend-model command type.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} payload - Command payload.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Saved model response.
     */
    static async executeCommand(commandType, payload) {
      if (commandType !== "update") throw new Error(`Unexpected command: ${commandType}`)

      const model = {
        name: payload.attributes.name,
        state: "saved",
        workspaceId: payload.id.workspaceId
      }

      if (beforeUpdateResponse) await beforeUpdateResponse(model)

      return {model}
    }

    /** @returns {string} - Task state. */
    state() { return this.readAttribute("state") }
  }
}

describe("Frontend model lifecycle subscription routing", () => {
  it("routes composite identities to the matching instance listener", async () => {
    const CompositeRoutedTask = buildCompositeRoutedTaskClass()
    const websocketClient = buildWebsocketClient()
    const task = new CompositeRoutedTask({name: "Composite task", state: "open", workspaceId: "alpha"})
    /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
    const eventIds = []

    FrontendModelBase.configureTransport({websocketClient})

    try {
      const unsubscribe = await task.onUpdate(({id}) => eventIds.push(id))
      const subscription = websocketClient.subscriptions[0]

      if (!subscription) throw new Error("Expected composite model subscription")

      subscription.options.onMessage({
        action: "update",
        id: {name: "Composite task", workspaceId: "alpha"},
        record: {name: "Composite task", state: "closed", workspaceId: "alpha"}
      })

      expect(eventIds).toEqual([{name: "Composite task", workspaceId: "alpha"}])
      expect(task.state()).toEqual("closed")

      unsubscribe()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("re-keys a destroy-only instance listener after a remote update", async () => {
    const CompositeRoutedTask = buildCompositeRoutedTaskClass()
    const websocketClient = buildWebsocketClient()
    const task = CompositeRoutedTask.instantiateFromResponse({name: "Composite task", state: "open", workspaceId: "alpha"})
    /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
    const destroyIds = []

    FrontendModelBase.configureTransport({websocketClient})

    try {
      const unsubscribe = await task.onDestroy(({id}) => destroyIds.push(id))
      const subscription = websocketClient.subscriptions[0]

      if (!subscription) throw new Error("Expected composite model subscription")

      const previousIdentity = {name: "Composite task", workspaceId: "alpha"}
      const rekeyedIdentity = {name: "Composite renamed", workspaceId: "alpha"}

      subscription.options.onMessage({
        action: "update",
        id: rekeyedIdentity,
        previousId: previousIdentity,
        record: {...rekeyedIdentity, state: "closed"}
      })
      subscription.options.onMessage({action: "destroy", id: rekeyedIdentity})

      expect(destroyIds).toEqual([rekeyedIdentity])

      unsubscribe()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("re-keys composite instance listeners and their unsubscribe callbacks after save", async () => {
    const CompositeRoutedTask = buildCompositeRoutedTaskClass()
    const websocketClient = buildWebsocketClient()
    const task = CompositeRoutedTask.instantiateFromResponse({name: "Composite task", state: "open", workspaceId: "alpha"})
    /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
    const updateIds = []
    /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
    const removedUpdateIds = []
    /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
    const destroyIds = []

    FrontendModelBase.configureTransport({websocketClient})

    try {
      const unsubscribeUpdate = await task.onUpdate(({id}) => updateIds.push(id))
      const unsubscribeRemovedUpdate = await task.onUpdate(({id}) => removedUpdateIds.push(id))
      const unsubscribeDestroy = await task.onDestroy(({id}) => destroyIds.push(id))
      const subscription = websocketClient.subscriptions[0]

      if (!subscription) throw new Error("Expected composite model subscription")

      task.setAttribute("name", "Composite renamed")
      await task.save()
      unsubscribeRemovedUpdate()

      const rekeyedIdentity = {name: "Composite renamed", workspaceId: "alpha"}

      subscription.options.onMessage({
        action: "update",
        id: rekeyedIdentity,
        record: {...rekeyedIdentity, state: "closed"}
      })
      subscription.options.onMessage({action: "destroy", id: rekeyedIdentity})

      expect(updateIds).toEqual([rekeyedIdentity])
      expect(removedUpdateIds).toEqual([])
      expect(destroyIds).toEqual([rekeyedIdentity])

      unsubscribeUpdate()
      unsubscribeDestroy()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("routes a re-key update broadcast before the save response arrives", async () => {
    const websocketClient = buildWebsocketClient()
    const rekeyedIdentity = {name: "Composite renamed", workspaceId: "alpha"}
    const CompositeRoutedTask = buildCompositeRoutedTaskClass({
      beforeUpdateResponse: (record) => {
        const subscription = websocketClient.subscriptions[0]

        if (!subscription) throw new Error("Expected composite model subscription")

        subscription.options.onMessage({
          action: "update",
          id: rekeyedIdentity,
          record: {...record, state: "broadcast"}
        })
      }
    })
    const task = CompositeRoutedTask.instantiateFromResponse({name: "Composite task", state: "open", workspaceId: "alpha"})
    /** @type {Array<string | import("../../src/utils/model-primary-key.js").CompositeModelPrimaryKeyValue>} */
    const updateIds = []

    FrontendModelBase.configureTransport({websocketClient})

    try {
      const unsubscribe = await task.onUpdate(({id}) => updateIds.push(id))

      task.setAttribute("name", rekeyedIdentity.name)
      await task.save()

      expect(updateIds).toEqual([rekeyedIdentity])

      unsubscribe()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("isolates distinct request contexts and delivers only matching events", async () => {
    const RoutedTask = buildRoutedTaskClass()
    const websocketClient = buildWebsocketClient()
    const alphaEvents = []
    const betaEvents = []
    const alphaContext = {workspaceId: "alpha"}

    FrontendModelBase.configureTransport({requestContext: () => ({workspaceId: "ambient"}), websocketClient})

    try {
      const unsubscribeAlpha = await RoutedTask.onUpdate(
        ({id}) => alphaEvents.push(id),
        {query: RoutedTask.where({workspaceId: "alpha"}), requestContext: alphaContext}
      )
      alphaContext.workspaceId = "mutated"
      const unsubscribeBeta = await RoutedTask.onUpdate(
        ({id}) => betaEvents.push(id),
        {query: RoutedTask.where({workspaceId: "beta"}), requestContext: {workspaceId: "beta"}}
      )

      expect(websocketClient.subscriptions).toHaveLength(2)
      expect(websocketClient.subscriptions.map(({options}) => options.params.workspaceId)).toEqual(["alpha", "beta"])
      expect(websocketClient.subscriptions.map(({options}) => options.params.eventFilters?.map(({where}) => where))).toEqual([
        [{workspaceId: "alpha"}],
        [{workspaceId: "beta"}]
      ])

      websocketClient.publishUpdate({id: "alpha-task", workspaceId: "alpha"})
      websocketClient.publishUpdate({id: "beta-task", workspaceId: "beta"})

      expect(alphaEvents).toEqual(["alpha-task"])
      expect(betaEvents).toEqual(["beta-task"])

      unsubscribeAlpha()
      unsubscribeBeta()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("multiplexes callbacks sharing one request context", async () => {
    const RoutedTask = buildRoutedTaskClass()
    const websocketClient = buildWebsocketClient()
    const openEvents = []
    const closedEvents = []

    FrontendModelBase.configureTransport({websocketClient})

    try {
      const [unsubscribeOpen, unsubscribeClosed, unsubscribeDestroy] = await Promise.all([
        RoutedTask.onUpdate(
          ({id}) => openEvents.push(id),
          {query: RoutedTask.where({workspaceId: "alpha", state: "open"}), requestContext: {workspaceId: "alpha"}}
        ),
        RoutedTask.onUpdate(
          ({id}) => closedEvents.push(id),
          {query: RoutedTask.where({workspaceId: "alpha", state: "closed"}), requestContext: {workspaceId: "alpha"}}
        ),
        RoutedTask.onDestroy(
          () => {},
          {requestContext: {workspaceId: "alpha"}}
        )
      ])

      expect(websocketClient.subscriptions).toHaveLength(1)
      expect(websocketClient.subscriptions[0].options.params.eventFilters).toHaveLength(2)
      expect(websocketClient.subscriptions[0].options.params.destroyEventDelivery).toEqual(true)

      websocketClient.publishUpdate({id: "closed-task", state: "closed", workspaceId: "alpha"})

      expect(openEvents).toEqual([])
      expect(closedEvents).toEqual(["closed-task"])

      unsubscribeOpen()
      unsubscribeClosed()
      unsubscribeDestroy()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("keeps reconnect and unsubscribe lifecycle isolated by request context", async () => {
    const RoutedTask = buildRoutedTaskClass()
    const websocketClient = buildWebsocketClient()
    const alphaEvents = []
    const betaEvents = []

    FrontendModelBase.configureTransport({websocketClient})

    try {
      const unsubscribeAlpha = await RoutedTask.onUpdate(
        ({id}) => alphaEvents.push(id),
        {query: RoutedTask.where({workspaceId: "alpha"}), requestContext: {workspaceId: "alpha"}}
      )
      const unsubscribeBeta = await RoutedTask.onUpdate(
        ({id}) => betaEvents.push(id),
        {query: RoutedTask.where({workspaceId: "beta"}), requestContext: {workspaceId: "beta"}}
      )

      websocketClient.reconnect()

      expect(websocketClient.subscriptions.map(({resumeCount}) => resumeCount)).toEqual([1, 1])

      unsubscribeAlpha()
      websocketClient.reconnect()
      websocketClient.publishUpdate({id: "beta-after-reconnect", workspaceId: "beta"})

      expect(websocketClient.subscriptions[0].closed).toEqual(true)
      expect(websocketClient.subscriptions[0].resumeCount).toEqual(1)
      expect(websocketClient.subscriptions[1].closed).toEqual(false)
      expect(websocketClient.subscriptions[1].resumeCount).toEqual(2)
      expect(alphaEvents).toEqual([])
      expect(betaEvents).toEqual(["beta-after-reconnect"])

      unsubscribeBeta()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("cleans up only the request-context bucket whose acknowledgement fails", async () => {
    const RoutedTask = buildRoutedTaskClass()
    const websocketClient = buildWebsocketClient({rejectFirstWorkspaceId: "alpha"})

    FrontendModelBase.configureTransport({websocketClient})

    try {
      await expect(async () => await RoutedTask.onUpdate(
        () => {},
        {query: RoutedTask.where({workspaceId: "alpha"}), requestContext: {workspaceId: "alpha"}}
      )).toThrow(/Subscription rejected for alpha/)

      const unsubscribeBeta = await RoutedTask.onUpdate(
        () => {},
        {query: RoutedTask.where({workspaceId: "beta"}), requestContext: {workspaceId: "beta"}}
      )
      const unsubscribeAlpha = await RoutedTask.onUpdate(
        () => {},
        {query: RoutedTask.where({workspaceId: "alpha"}), requestContext: {workspaceId: "alpha"}}
      )

      expect(websocketClient.subscriptions.map(({closed}) => closed)).toEqual([true, false, false])
      expect(websocketClient.subscriptions[1].options.params.eventFilters?.[0]?.where).toEqual({workspaceId: "beta"})
      expect(websocketClient.subscriptions[2].options.params.eventFilters?.[0]?.where).toEqual({workspaceId: "alpha"})

      unsubscribeBeta()
      unsubscribeAlpha()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("releases an instance request-context bucket after acknowledgement fails", async () => {
    const RoutedTask = buildRoutedTaskClass()
    const task = new RoutedTask({id: "alpha-task", workspaceId: "alpha"})
    const websocketClient = buildWebsocketClient({rejectFirstWorkspaceId: "alpha"})

    FrontendModelBase.configureTransport({websocketClient})

    try {
      await expect(async () => await task.onUpdate(
        () => {},
        {requestContext: {workspaceId: "alpha"}}
      )).toThrow(/Subscription rejected for alpha/)

      const unsubscribe = await task.onUpdate(
        () => {},
        {requestContext: {workspaceId: "alpha"}}
      )

      expect(websocketClient.subscriptions.map(({closed}) => closed)).toEqual([true, false])
      unsubscribe()
    } finally {
      resetFrontendModelTransport()
    }
  })
})
