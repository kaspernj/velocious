// @ts-check

import React from "react"
import {createRoot} from "react-dom/client"

import useDestroyedEvent from "../frontend-models/use-destroyed-event.js"
import useCreatedEvent from "../frontend-models/use-created-event.js"
import FrontendModelBase from "../frontend-models/base.js"
import useModelClassEvent from "../frontend-models/use-model-class-event.js"
import useUpdatedEvent from "../frontend-models/use-updated-event.js"
import wait from "awaitery/build/wait.js"

/** @typedef {import("../frontend-models/base.js").FrontendModelResourceConfig} FrontendModelResourceConfig */
/** @typedef {{id: string, model: FrontendModelBase}} FrontendModelHookTestCreateUpdatePayload */
/** @typedef {{id: string}} FrontendModelHookTestDestroyPayload */
/**
 * @typedef {object} FakeSubscriptions
 * @property {Set<(payload: FrontendModelHookTestCreateUpdatePayload) => void>} create - Create callbacks.
 * @property {Set<(payload: FrontendModelHookTestDestroyPayload) => void>} destroy - Destroy callbacks.
 * @property {{create: import("../frontend-models/query.js").FrontendModelEventOptionsObject[], destroy: import("../frontend-models/query.js").FrontendModelEventOptionsObject[], update: import("../frontend-models/query.js").FrontendModelEventOptionsObject[]}} options - Subscription options.
 * @property {Set<(payload: FrontendModelHookTestCreateUpdatePayload) => void>} update - Update callbacks.
 */

/** @returns {Promise<void>} - Resolves after React effects have run. */
async function flushEffects() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * @param {() => boolean} callback - Predicate to wait for.
 * @returns {Promise<void>} - Resolves when the predicate returns true.
 */
async function waitFor(callback) {
  const startedAt = Date.now()

  while (!callback()) {
    if (Date.now() - startedAt > 1000) return

    await wait(10)
  }
}

/** @returns {FakeSubscriptions} - Empty fake subscription store. */
function buildFakeSubscriptions() {
  return {
    create: new Set(),
    destroy: new Set(),
    options: {create: [], destroy: [], update: []},
    update: new Set()
  }
}

/**
 * @param {string} modelName - Fake frontend model name.
 * @returns {FrontendModelResourceConfig} - Minimal resource config for fake subclasses.
 */
function fakeResourceConfig(modelName) {
  return {
    attributes: ["id"],
    modelName,
    primaryKey: "id"
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

/** @returns {{ModelClass: typeof FrontendModelBase, subscriptions: FakeSubscriptions}} - Fake model class setup. */
function buildFakeModelClass() {
  const subscriptions = buildFakeSubscriptions()

  class FakeModelClass extends FrontendModelBase {
    /** @returns {FrontendModelResourceConfig} - Fake resource config. */
    static resourceConfig() {
      return fakeResourceConfig("HookFakeClassModel")
    }

    /**
     * @param {(payload: FrontendModelHookTestCreateUpdatePayload) => void} callback - Event callback.
     * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onCreate(callback, options = {}) {
      subscriptions.create.add(callback)
      subscriptions.options.create.push(options)

      return () => subscriptions.create.delete(callback)
    }

    /**
     * @param {(payload: FrontendModelHookTestDestroyPayload) => void} callback - Event callback.
     * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onDestroy(callback, options = {}) {
      subscriptions.destroy.add(callback)
      subscriptions.options.destroy.push(options)

      return () => subscriptions.destroy.delete(callback)
    }

    /**
     * @param {(payload: FrontendModelHookTestCreateUpdatePayload) => void} callback - Event callback.
     * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onUpdate(callback, options = {}) {
      subscriptions.update.add(callback)
      subscriptions.options.update.push(options)

      return () => subscriptions.update.delete(callback)
    }
  }

  return {ModelClass: FakeModelClass, subscriptions}
}

/**
 * @param {FakeSubscriptions} subscriptions - Callback sets.
 * @param {"create" | "destroy" | "update"} eventName - Event name.
 * @param {FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload} payload - Event payload.
 * @returns {void}
 */
function emitEvent(subscriptions, eventName, payload) {
  if (eventName === "destroy") {
    for (const callback of subscriptions.destroy) {
      callback({id: payload.id})
    }

    return
  }

  if (!("model" in payload)) {
    throw new Error(`Expected model payload for ${eventName}`)
  }

  for (const callback of subscriptions[eventName]) {
    callback(payload)
  }
}

/**
 * @param {string} id - Model id.
 * @param {FakeSubscriptions} subscriptions - Callback sets.
 * @returns {FrontendModelBase} - Fake model instance.
 */
function buildFakeModel(id, subscriptions) {
  class FakeModel extends FrontendModelBase {
    /** @returns {FrontendModelResourceConfig} - Fake resource config. */
    static resourceConfig() {
      return fakeResourceConfig("HookFakeInstanceModel")
    }

    /**
     * @param {(payload: FrontendModelHookTestDestroyPayload) => void} callback - Event callback.
     * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    async onDestroy(callback, options = {}) {
      subscriptions.destroy.add(callback)
      subscriptions.options.destroy.push(options)

      return () => subscriptions.destroy.delete(callback)
    }

    /**
     * @param {(payload: FrontendModelHookTestCreateUpdatePayload) => void} callback - Event callback.
     * @param {import("../frontend-models/query.js").FrontendModelEventOptionsObject} [options] - Event query or projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    async onUpdate(callback, options = {}) {
      subscriptions.update.add(callback)
      subscriptions.options.update.push(options)

      return () => subscriptions.update.delete(callback)
    }

    /** @returns {string} - Primary key value. */
    primaryKeyValue() {
      return id
    }
  }

  return new FakeModel({id})
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function classLifecycleScenario() {
  const {ModelClass, subscriptions} = buildFakeModelClass()
  const eventModel = buildFakeModel("1", buildFakeSubscriptions())
  /** @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
  const receivedEvents = []
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

  emitEvent(subscriptions, "create", {id: "1", model: eventModel})
  emitEvent(subscriptions, "update", {id: "1", model: eventModel})
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
  const subscriptions = buildFakeSubscriptions()
  const model = buildFakeModel("task-1", subscriptions)
  /** @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
  const receivedEvents = []
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
async function projectionOptionsScenario() {
  const {ModelClass, subscriptions: classSubscriptions} = buildFakeModelClass()
  const instanceSubscriptions = buildFakeSubscriptions()
  const model = buildFakeModel("task-1", instanceSubscriptions)
  const classQuery = ModelClass
    .where({id: "task-1"})
    .select(["id"])

  /** @returns {React.ReactElement} - Test element. */
  function TestComponent() {
    useCreatedEvent(ModelClass, () => {}, {
      preload: "project",
      query: classQuery,
      select: {Task: ["id", "nameUppercase"]}
    })
    useUpdatedEvent(model, () => {}, {
      select: ["id"],
      withCount: "comments"
    })
    useDestroyedEvent(model, () => {}, {
      preload: "project",
      select: ["id"]
    })

    return React.createElement("div")
  }

  const controls = await renderElement(React.createElement(TestComponent))
  await waitFor(() => classSubscriptions.create.size === 1 && instanceSubscriptions.update.size === 1 && instanceSubscriptions.destroy.size === 1)

  const createOptions = classSubscriptions.options.create[0] || {}
  const updateOptions = instanceSubscriptions.options.update[0] || {}
  const destroyOptions = instanceSubscriptions.options.destroy[0] || {}

  await controls.unmount()

  return {
    classCreatePreloadProject: createOptions.preload === "project" ? 1 : 0,
    classCreateQueryPassed: createOptions.query === classQuery ? 1 : 0,
    classCreateSelectCount: createOptions.select && typeof createOptions.select === "object" && !Array.isArray(createOptions.select) && Array.isArray(createOptions.select.Task) ? createOptions.select.Task.length : 0,
    instanceDestroyPreloadProject: destroyOptions.preload === "project" ? 1 : 0,
    instanceDestroySelectCount: Array.isArray(destroyOptions.select) ? destroyOptions.select.length : 0,
    instanceUpdateSelectCount: Array.isArray(updateOptions.select) ? updateOptions.select.length : 0,
    instanceUpdateWithCountComments: updateOptions.withCount === "comments" ? 1 : 0
  }
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function debounceUnmountScenario() {
  const {ModelClass, subscriptions: classSubscriptions} = buildFakeModelClass()
  const instanceSubscriptions = buildFakeSubscriptions()
  const model = buildFakeModel("task-1", instanceSubscriptions)
  /** @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
  const receivedEvents = []

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
  await wait(30)

  return {receivedEventsAfterDebounceWindow: receivedEvents.length}
}

/** @returns {Promise<Record<string, number>>} - Scenario result. */
async function resubscribeInstanceScenario() {
  const firstSubscriptions = buildFakeSubscriptions()
  const secondSubscriptions = buildFakeSubscriptions()
  const firstModel = buildFakeModel("task-1", firstSubscriptions)
  const secondModel = buildFakeModel("task-1", secondSubscriptions)
  /** @type {Array<FrontendModelHookTestCreateUpdatePayload | FrontendModelHookTestDestroyPayload>} */
  const receivedEvents = []

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
  projectionOptions: projectionOptionsScenario,
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
