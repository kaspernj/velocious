// @ts-check

import debounceFunction from "debounce"
import {useEffect, useMemo, useRef} from "react"

import useModelClassEvent from "./use-model-class-event.js"

/** @typedef {typeof import("./base.js").default} FrontendModelClass */
/** @typedef {import("./base.js").default} FrontendModelInstance */
/** @typedef {import("./use-model-class-event.js").FrontendModelCreateUpdateEventPayload} FrontendModelClassUpdateEventPayload */
/** @typedef {{id: string, model: FrontendModelInstance}} FrontendModelInstanceUpdateEventPayload */
/** @typedef {FrontendModelClassUpdateEventPayload | FrontendModelInstanceUpdateEventPayload} FrontendModelUpdateEventPayload */
/** @typedef {import("./use-model-class-event.js").UseModelClassEventOptions} UseUpdatedEventOptions */
/** @typedef {(payload: FrontendModelUpdateEventPayload) => void} FrontendModelUpdateEventCallback */

/**
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @returns {FrontendModelInstance[]} - Normalized model list.
 */
function modelsFromInput(modelOrModels) {
  if (!modelOrModels) return []
  if (Array.isArray(modelOrModels)) return modelOrModels.filter(Boolean)

  return [modelOrModels]
}

/**
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @returns {string} - Stable dependency key.
 */
function modelsDependencyKey(modelOrModels) {
  return JSON.stringify(modelsFromInput(modelOrModels).map((model) => model.primaryKeyValue()))
}

/**
 * @param {Record<string, unknown>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
  const unknownOptionNames = Object.keys(restOptions)

  if (unknownOptionNames.length > 0) {
    throw new Error(`Unknown options given to useUpdatedEvent: ${unknownOptionNames.join(", ")}`)
  }
}

/**
 * React hook for frontend-model update events. Pass a model class for class-level
 * update events, or a model / model array for instance-level update events.
 * @param {FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelClassOrModels - Model class, model, or models.
 * @param {FrontendModelUpdateEventCallback} callback - Event callback.
 * @param {UseUpdatedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useUpdatedEvent(modelClassOrModels, callback, options = {}) {
  const {active = true, debounce = false, onConnected, ...restOptions} = options
  assertNoUnknownOptions(restOptions)

  const classModel = typeof modelClassOrModels === "function" ? modelClassOrModels : null
  const instanceModels = typeof modelClassOrModels === "function" ? null : modelClassOrModels

  useModelClassEvent(classModel, "update", (payload) => {
    callback(/** @type {FrontendModelClassUpdateEventPayload} */ (payload))
  }, {active: active && Boolean(classModel), debounce, onConnected})
  useInstanceUpdatedEvent(instanceModels, callback, {active: active && !classModel, debounce, onConnected})
}

/**
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @param {FrontendModelUpdateEventCallback} callback - Event callback.
 * @param {UseUpdatedEventOptions} options - Hook options.
 * @returns {void}
 */
function useInstanceUpdatedEvent(modelOrModels, callback, options) {
  const {active = true, debounce = false, onConnected} = options
  const callbackRef = useRef(callback)
  const activeRef = useRef(active)
  callbackRef.current = callback
  activeRef.current = active

  const modelsKey = modelsDependencyKey(modelOrModels)
  const eventCallback = useMemo(() => {
    const wrappedCallback = (/** @type {FrontendModelInstanceUpdateEventPayload} */ payload) => {
      if (activeRef.current) callbackRef.current(payload)
    }

    if (typeof debounce === "number") return debounceFunction(wrappedCallback, debounce)
    if (debounce) return debounceFunction(wrappedCallback)

    return wrappedCallback
  }, [debounce])

  useEffect(() => {
    if (!active) return undefined

    const models = modelsFromInput(modelOrModels)
    if (models.length < 1) return undefined

    let closed = false
    /** @type {Array<() => void>} */
    const unsubscribeCallbacks = []

    void (async () => {
      for (const model of models) {
        const unsubscribe = await model.onUpdate(eventCallback)

        if (closed) {
          unsubscribe()
        } else {
          unsubscribeCallbacks.push(unsubscribe)
        }
      }

      if (!closed && onConnected) onConnected()
    })()

    return () => {
      closed = true

      for (const unsubscribe of unsubscribeCallbacks) {
        unsubscribe()
      }
    }
  }, [active, eventCallback, modelsKey, onConnected])
}
