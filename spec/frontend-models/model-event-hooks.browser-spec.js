// @ts-check

import React from "react"
import {createRoot} from "react-dom/client"

import {describe, expect, it} from "../../src/testing/test.js"
import useDestroyedEvent from "../../src/frontend-models/use-destroyed-event.js"
import useCreatedEvent from "../../src/frontend-models/use-created-event.js"
import useModelClassEvent from "../../src/frontend-models/use-model-class-event.js"
import useUpdatedEvent from "../../src/frontend-models/use-updated-event.js"

/**
 * @typedef {object} FakeSubscriptions
 * @property {Set<(payload: unknown) => void>} create - Create callbacks.
 * @property {Set<(payload: unknown) => void>} destroy - Destroy callbacks.
 * @property {Set<(payload: unknown) => void>} update - Update callbacks.
 */

/** @returns {Promise<void>} - Resolves after React effects have run. */
async function flushEffects() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * @param {React.ReactElement} element - Element to render.
 * @returns {Promise<{rerender: (nextElement: React.ReactElement) => Promise<void>, unmount: () => Promise<void>}>} - Render controls.
 */
async function renderElement(element) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)

  root.render(element)
  await flushEffects()

  return {
    rerender: async (nextElement) => {
      root.render(nextElement)
      await flushEffects()
    },
    unmount: async () => {
      root.unmount()
      container.remove()
      await flushEffects()
    }
  }
}

/** @returns {{ModelClass: typeof import("../../src/frontend-models/base.js").default, subscriptions: FakeSubscriptions}} - Fake model class setup. */
function buildFakeModelClass() {
  const subscriptions = {
    create: new Set(),
    destroy: new Set(),
    update: new Set()
  }
  const ModelClass = /** @type {typeof import("../../src/frontend-models/base.js").default} */ ({
    onCreate: async (callback) => {
      subscriptions.create.add(callback)

      return () => subscriptions.create.delete(callback)
    },
    onDestroy: async (callback) => {
      subscriptions.destroy.add(callback)

      return () => subscriptions.destroy.delete(callback)
    },
    onUpdate: async (callback) => {
      subscriptions.update.add(callback)

      return () => subscriptions.update.delete(callback)
    }
  })

  return {ModelClass, subscriptions}
}

/**
 * @param {FakeSubscriptions} subscriptions - Callback sets.
 * @param {"create" | "destroy" | "update"} eventName - Event name.
 * @param {unknown} payload - Event payload.
 * @returns {void}
 */
function emitEvent(subscriptions, eventName, payload) {
  for (const callback of subscriptions[eventName]) {
    callback(payload)
  }
}

/**
 * @param {string} id - Model id.
 * @param {FakeSubscriptions} subscriptions - Callback sets.
 * @returns {import("../../src/frontend-models/base.js").default} - Fake model instance.
 */
function buildFakeModel(id, subscriptions) {
  return /** @type {import("../../src/frontend-models/base.js").default} */ ({
    onDestroy: async (callback) => {
      subscriptions.destroy.add(callback)

      return () => subscriptions.destroy.delete(callback)
    },
    onUpdate: async (callback) => {
      subscriptions.update.add(callback)

      return () => subscriptions.update.delete(callback)
    },
    primaryKeyValue: () => id
  })
}

describe("Frontend model event hooks", () => {
  it("subscribes to class lifecycle events and unsubscribes on unmount", async () => {
    const {ModelClass, subscriptions} = buildFakeModelClass()
    const receivedEvents = /** @type {unknown[]} */ ([])
    let connectedCount = 0

    /** @returns {React.ReactElement} */
    function TestComponent() {
      useModelClassEvent(ModelClass, ["create", "update"], (payload) => receivedEvents.push(payload), {
        onConnected: () => { connectedCount += 1 }
      })
      useCreatedEvent(ModelClass, (payload) => receivedEvents.push(payload))

      return React.createElement("div")
    }

    const controls = await renderElement(React.createElement(TestComponent))

    expect(subscriptions.create.size).toEqual(2)
    expect(subscriptions.update.size).toEqual(1)
    expect(subscriptions.destroy.size).toEqual(0)
    expect(connectedCount).toEqual(1)

    emitEvent(subscriptions, "create", {id: "1", model: {id: "1"}})
    emitEvent(subscriptions, "update", {id: "1", model: {id: "1"}})
    emitEvent(subscriptions, "destroy", {id: "1"})

    expect(receivedEvents.length).toEqual(3)

    await controls.unmount()

    expect(subscriptions.create.size).toEqual(0)
    expect(subscriptions.update.size).toEqual(0)
  })

  it("subscribes to instance update and destroy events", async () => {
    const subscriptions = {create: new Set(), destroy: new Set(), update: new Set()}
    const model = buildFakeModel("task-1", subscriptions)
    const receivedEvents = /** @type {unknown[]} */ ([])
    let connectedCount = 0

    /** @returns {React.ReactElement} */
    function TestComponent() {
      useUpdatedEvent(model, (payload) => receivedEvents.push(payload), {
        onConnected: () => { connectedCount += 1 }
      })
      useDestroyedEvent([model], (payload) => receivedEvents.push(payload), {
        onConnected: () => { connectedCount += 1 }
      })

      return React.createElement("div")
    }

    const controls = await renderElement(React.createElement(TestComponent))

    expect(subscriptions.update.size).toEqual(1)
    expect(subscriptions.destroy.size).toEqual(1)
    expect(connectedCount).toEqual(2)

    emitEvent(subscriptions, "update", {id: "task-1", model})
    emitEvent(subscriptions, "destroy", {id: "task-1"})

    expect(receivedEvents.length).toEqual(2)

    await controls.unmount()

    expect(subscriptions.update.size).toEqual(0)
    expect(subscriptions.destroy.size).toEqual(0)
  })
})
