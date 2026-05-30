// @ts-check

import React from "react"
import {createRoot} from "react-dom/client"

import useDestroyedEvent from "../frontend-models/use-destroyed-event.js"
import useCreatedEvent from "../frontend-models/use-created-event.js"
import useModelClassEvent from "../frontend-models/use-model-class-event.js"
import useUpdatedEvent from "../frontend-models/use-updated-event.js"

/**
 * @typedef {object} FakeSubscriptions
 * @property {Set<(payload: unknown) => void>} create - Create callbacks.
 * @property {Set<(payload: unknown) => void>} destroy - Destroy callbacks.
 * @property {Set<(payload: unknown) => void>} update - Update callbacks.
 */

/** @returns {Promise<void>} - Resolves after React effects have run. */
async function flushEffects() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * @param {number} milliseconds - Milliseconds to wait.
 * @returns {Promise<void>} - Resolves after the delay.
 */
async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * @param {() => boolean} callback - Predicate to wait for.
 * @returns {Promise<void>} - Resolves when the predicate returns true.
 */
async function waitFor(callback) {
  const startedAt = Date.now()

  while (!callback()) {
    if (Date.now() - startedAt > 1000) return

    await sleep(10)
  }
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

/** @returns {{ModelClass: typeof import("../frontend-models/base.js").default, subscriptions: FakeSubscriptions}} - Fake model class setup. */
function buildFakeModelClass() {
  const subscriptions = {
    create: new Set(),
    destroy: new Set(),
    update: new Set()
  }
  const ModelClass = /** @type {typeof import("../frontend-models/base.js").default} */ (/** @type {unknown} */ ({
    onCreate: async (/** @type {(payload: unknown) => void} */ callback) => {
      subscriptions.create.add(callback)

      return () => subscriptions.create.delete(callback)
    },
    onDestroy: async (/** @type {(payload: unknown) => void} */ callback) => {
      subscriptions.destroy.add(callback)

      return () => subscriptions.destroy.delete(callback)
    },
    onUpdate: async (/** @type {(payload: unknown) => void} */ callback) => {
      subscriptions.update.add(callback)

      return () => subscriptions.update.delete(callback)
    }
  }))

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
 * @returns {import("../frontend-models/base.js").default} - Fake model instance.
 */
function buildFakeModel(id, subscriptions) {
  return /** @type {import("../frontend-models/base.js").default} */ (/** @type {unknown} */ ({
    onDestroy: async (/** @type {(payload: unknown) => void} */ callback) => {
      subscriptions.destroy.add(callback)

      return () => subscriptions.destroy.delete(callback)
    },
    onUpdate: async (/** @type {(payload: unknown) => void} */ callback) => {
      subscriptions.update.add(callback)

      return () => subscriptions.update.delete(callback)
    },
    primaryKeyValue: () => id
  }))
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function classLifecycleScenario() {
  const {ModelClass, subscriptions} = buildFakeModelClass()
  const receivedEvents = /** @type {unknown[]} */ ([])
  let connectedCount = 0

  /** @returns {React.ReactElement} - Test element. */
  function TestComponent() {
    useModelClassEvent(ModelClass, ["create", "update"], (payload) => receivedEvents.push(payload), {
      onConnected: () => { connectedCount += 1 }
    })
    useCreatedEvent(ModelClass, (payload) => receivedEvents.push(payload))

    return React.createElement("div")
  }

  const controls = await renderElement(React.createElement(TestComponent))
  await waitFor(() => subscriptions.create.size === 2 && subscriptions.update.size === 1)

  const mountedCreateSubscriptions = subscriptions.create.size
  const mountedUpdateSubscriptions = subscriptions.update.size
  const mountedDestroySubscriptions = subscriptions.destroy.size
  const mountedConnectedCount = connectedCount

  emitEvent(subscriptions, "create", {id: "1", model: {id: "1"}})
  emitEvent(subscriptions, "update", {id: "1", model: {id: "1"}})
  emitEvent(subscriptions, "destroy", {id: "1"})

  const receivedEventsAfterEmit = receivedEvents.length

  await controls.unmount()

  return {
    mountedConnectedCount,
    mountedCreateSubscriptions,
    mountedDestroySubscriptions,
    mountedUpdateSubscriptions,
    receivedEventsAfterEmit,
    unmountedCreateSubscriptions: subscriptions.create.size,
    unmountedUpdateSubscriptions: subscriptions.update.size
  }
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function instanceLifecycleScenario() {
  const subscriptions = {create: new Set(), destroy: new Set(), update: new Set()}
  const model = buildFakeModel("task-1", subscriptions)
  const receivedEvents = /** @type {unknown[]} */ ([])
  let connectedCount = 0

  /** @returns {React.ReactElement} - Test element. */
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
  await waitFor(() => subscriptions.update.size === 1 && subscriptions.destroy.size === 1)

  const mountedConnectedCount = connectedCount
  const mountedDestroySubscriptions = subscriptions.destroy.size
  const mountedUpdateSubscriptions = subscriptions.update.size

  emitEvent(subscriptions, "update", {id: "task-1", model})
  emitEvent(subscriptions, "destroy", {id: "task-1"})

  const receivedEventsAfterEmit = receivedEvents.length

  await controls.unmount()

  return {
    mountedConnectedCount,
    mountedDestroySubscriptions,
    mountedUpdateSubscriptions,
    receivedEventsAfterEmit,
    unmountedDestroySubscriptions: subscriptions.destroy.size,
    unmountedUpdateSubscriptions: subscriptions.update.size
  }
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function debounceUnmountScenario() {
  const {ModelClass, subscriptions: classSubscriptions} = buildFakeModelClass()
  const instanceSubscriptions = {create: new Set(), destroy: new Set(), update: new Set()}
  const model = buildFakeModel("task-1", instanceSubscriptions)
  const receivedEvents = /** @type {unknown[]} */ ([])

  /** @returns {React.ReactElement} - Test element. */
  function TestComponent() {
    useModelClassEvent(ModelClass, "update", (payload) => receivedEvents.push(payload), {debounce: 20})
    useUpdatedEvent(model, (payload) => receivedEvents.push(payload), {debounce: 20})
    useDestroyedEvent(model, (payload) => receivedEvents.push(payload), {debounce: 20})

    return React.createElement("div")
  }

  const controls = await renderElement(React.createElement(TestComponent))
  await waitFor(() => classSubscriptions.update.size === 1 && instanceSubscriptions.update.size === 1 && instanceSubscriptions.destroy.size === 1)

  emitEvent(classSubscriptions, "update", {id: "task-1", model})
  emitEvent(instanceSubscriptions, "update", {id: "task-1", model})
  emitEvent(instanceSubscriptions, "destroy", {id: "task-1"})

  await controls.unmount()
  await sleep(30)

  return {receivedEventsAfterDebounceWindow: receivedEvents.length}
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function resubscribeInstanceScenario() {
  const firstSubscriptions = {create: new Set(), destroy: new Set(), update: new Set()}
  const secondSubscriptions = {create: new Set(), destroy: new Set(), update: new Set()}
  const firstModel = buildFakeModel("task-1", firstSubscriptions)
  const secondModel = buildFakeModel("task-1", secondSubscriptions)
  const receivedEvents = /** @type {unknown[]} */ ([])

  /**
   * @param {{model: import("../frontend-models/base.js").default}} props - Component props.
   * @returns {React.ReactElement} - Test element.
   */
  function TestComponent({model}) {
    useUpdatedEvent(model, (payload) => receivedEvents.push(payload))
    useDestroyedEvent(model, (payload) => receivedEvents.push(payload))

    return React.createElement("div")
  }

  const controls = await renderElement(React.createElement(TestComponent, {model: firstModel}))
  await waitFor(() => firstSubscriptions.update.size === 1 && firstSubscriptions.destroy.size === 1)

  const firstMountedDestroySubscriptions = firstSubscriptions.destroy.size
  const firstMountedUpdateSubscriptions = firstSubscriptions.update.size

  await controls.rerender(React.createElement(TestComponent, {model: secondModel}))
  await waitFor(() => firstSubscriptions.update.size === 0 && firstSubscriptions.destroy.size === 0 && secondSubscriptions.update.size === 1 && secondSubscriptions.destroy.size === 1)

  const firstAfterRerenderDestroySubscriptions = firstSubscriptions.destroy.size
  const firstAfterRerenderUpdateSubscriptions = firstSubscriptions.update.size
  const secondAfterRerenderDestroySubscriptions = secondSubscriptions.destroy.size
  const secondAfterRerenderUpdateSubscriptions = secondSubscriptions.update.size

  emitEvent(firstSubscriptions, "update", {id: "task-1", model: firstModel})
  emitEvent(secondSubscriptions, "update", {id: "task-1", model: secondModel})
  emitEvent(secondSubscriptions, "destroy", {id: "task-1"})

  const receivedEventsAfterEmit = receivedEvents.length

  await controls.unmount()

  return {
    firstAfterRerenderDestroySubscriptions,
    firstAfterRerenderUpdateSubscriptions,
    firstMountedDestroySubscriptions,
    firstMountedUpdateSubscriptions,
    receivedEventsAfterEmit,
    secondAfterRerenderDestroySubscriptions,
    secondAfterRerenderUpdateSubscriptions
  }
}

const scenarios = {
  classLifecycle: classLifecycleScenario,
  debounceUnmount: debounceUnmountScenario,
  instanceLifecycle: instanceLifecycleScenario,
  resubscribeInstance: resubscribeInstanceScenario
}

/**
 * @param {keyof typeof scenarios} scenarioName - Scenario name.
 * @returns {Promise<Record<string, number>>} - Scenario result.
 */
export default async function runFrontendModelEventHookScenario(scenarioName) {
  const scenario = scenarios[scenarioName]

  if (!scenario) throw new Error(`Unknown frontend model event hook scenario: ${scenarioName}`)

  return await scenario()
}
