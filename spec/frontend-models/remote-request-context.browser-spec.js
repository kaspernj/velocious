// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import {resetFrontendModelTransport} from "../helpers/frontend-model-test-helpers.js"

/** @param {{autoReconnect?: boolean}} [args] - Client controls. @returns {{autoReconnect: boolean, subscriptions: Array<Record<string, ReturnType<typeof JSON.parse>>>, subscribeChannel: (channel: string, options: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>}} Recording websocket client. */
function buildWebsocketClient({autoReconnect = true} = {}) {
  const client = {
    autoReconnect,
    subscriptions: /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ ([]),
    subscribeChannel: (channel, options) => {
      const subscription = {
        channel,
        close: () => {
          subscription.closed = true
        },
        closed: false,
        isClosed: () => subscription.closed,
        options,
        ready: Promise.resolve()
      }

      client.subscriptions.push(subscription)

      return subscription
    }
  }

  return client
}

/** Flushes microtasks until a condition holds. @param {() => boolean} condition - Completion condition. @returns {Promise<void>} */
async function flushUntil(condition) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await Promise.resolve()
  }

  throw new Error("Condition was not reached while flushing microtasks")
}

describe("frontend-model websocket remote request context", () => {
  it("isolates concurrent contexts and retains captured context on reconnect", async () => {
    class RealtimeTask extends FrontendModelBase {
      /** @returns {{attributes: string[], primaryKey: string}} Resource configuration. */
      static resourceConfig() { return {attributes: ["id"], primaryKey: "id"} }
    }

    const websocketClient = buildWebsocketClient()
    const sourceContext = {projectId: "project-alpha", routingEpoch: 3}
    let activeContext = sourceContext

    FrontendModelBase.configureTransport({requestContext: () => activeContext, websocketClient})

    try {
      const unsubscribeAlpha = await RealtimeTask.onCreate(() => {})

      sourceContext.projectId = "project-mutated"
      activeContext = {projectId: "project-beta", routingEpoch: 4}

      const unsubscribeBeta = await RealtimeTask.onUpdate(() => {})

      expect(websocketClient.subscriptions.map(({options}) => options.params)).toEqual([
        {model: "RealtimeTask", projectId: "project-alpha", routingEpoch: 3},
        {model: "RealtimeTask", projectId: "project-beta", routingEpoch: 4}
      ])

      websocketClient.subscriptions[0].options.onClose()
      await flushUntil(() => websocketClient.subscriptions.length === 3)

      expect(websocketClient.subscriptions[2].options.params).toEqual({
        model: "RealtimeTask",
        projectId: "project-alpha",
        routingEpoch: 3
      })

      unsubscribeAlpha()
      unsubscribeBeta()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("releases an empty context bucket after the websocket closes without reconnect", async () => {
    class ClosedRealtimeTask extends FrontendModelBase {
      /** @returns {{attributes: string[], primaryKey: string}} Resource configuration. */
      static resourceConfig() { return {attributes: ["id"], primaryKey: "id"} }
    }

    const websocketClient = buildWebsocketClient({autoReconnect: false})
    // -0 and 0 share a serialized context key, so the next handle reveals whether the old bucket was reused.
    let activeContext = {routingEpoch: -0}

    FrontendModelBase.configureTransport({requestContext: () => activeContext, websocketClient})

    try {
      const unsubscribe = await ClosedRealtimeTask.onCreate(() => {})

      websocketClient.subscriptions[0].options.onClose()
      unsubscribe()
      activeContext = {routingEpoch: 0}

      const unsubscribeReplacement = await ClosedRealtimeTask.onCreate(() => {})

      expect(websocketClient.subscriptions.length).toEqual(2)
      expect(Object.is(websocketClient.subscriptions[1].options.params.routingEpoch, -0)).toBe(false)
      unsubscribeReplacement()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("rejects websocket reserved-key collisions before subscribing", async () => {
    class InvalidRealtimeTask extends FrontendModelBase {
      /** @returns {{attributes: string[], primaryKey: string}} Resource configuration. */
      static resourceConfig() { return {attributes: ["id"], primaryKey: "id"} }
    }

    const websocketClient = buildWebsocketClient()

    FrontendModelBase.configureTransport({requestContext: () => ({model: "Shadowed"}), websocketClient})

    try {
      await expect(async () => await InvalidRealtimeTask.onCreate(() => {})).toThrow(/model.*reserved/iu)
      expect(websocketClient.subscriptions).toEqual([])
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("captures context for public websocket channel subscriptions without changing unscoped options", async () => {
    const websocketClient = buildWebsocketClient()
    const sourceContext = {projectId: "project-alpha", routingEpoch: 3}

    FrontendModelBase.configureTransport({requestContext: () => sourceContext, websocketClient})

    try {
      FrontendModelBase.subscribeWebsocketChannel("ProjectEvents", {params: {topic: "tasks"}})

      sourceContext.projectId = "project-mutated"

      expect(websocketClient.subscriptions[0].options.params).toEqual({
        projectId: "project-alpha",
        routingEpoch: 3,
        topic: "tasks"
      })

      await expect(() => FrontendModelBase.subscribeWebsocketChannel("ProjectEvents", {params: {projectId: "shadowed"}})).toThrow(/projectId.*reserved/iu)

      resetFrontendModelTransport()
      FrontendModelBase.configureTransport({websocketClient})
      FrontendModelBase.subscribeWebsocketChannel("UnscopedEvents")

      expect(websocketClient.subscriptions[1].options.params).toEqual(undefined)
    } finally {
      resetFrontendModelTransport()
    }
  })
})
