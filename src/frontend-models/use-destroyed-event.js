// @ts-check

import debounceFunction from "debounce"
import {useEffect, useMemo, useRef} from "react"

import clearPendingDebouncedCallback from "./clear-pending-debounced-callback.js"
import {modelsDependencyKey, modelsFromInput} from "./event-hook-models.js"
import useModelClassEvent from "./use-model-class-event.js"

/** @typedef {typeof import("./base.js").default} FrontendModelClass */
/** @typedef {import("./base.js").default} FrontendModelInstance */
/** @typedef {import("./use-model-class-event.js").FrontendModelDestroyEventPayload} FrontendModelClassDestroyEventPayload */
/** @typedef {{id: string}} FrontendModelInstanceDestroyEventPayload */
/** @typedef {FrontendModelClassDestroyEventPayload | FrontendModelInstanceDestroyEventPayload} FrontendModelDestroyEventPayload */
/** @typedef {import("./use-model-class-event.js").UseModelClassEventOptions} UseDestroyedEventOptions */
/** @typedef {(payload: FrontendModelDestroyEventPayload) => void} FrontendModelDestroyEventCallback */

/**
 * @param {Record<string, unknown>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
  const unknownOptionNames = Object.keys(restOptions)

  if (unknownOptionNames.length > 0) {
    throw new Error(`Unknown options given to useDestroyedEvent: ${unknownOptionNames.join(", ")}`)
  }
}

/**
 * React hook for frontend-model destroy events. Pass a model class for class-level
 * destroy events, or a model / model array for instance-level destroy events.
 * @param {FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelClassOrModels - Model class, model, or models.
 * @param {FrontendModelDestroyEventCallback} callback - Event callback.
 * @param {UseDestroyedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useDestroyedEvent(modelClassOrModels, callback, options = {}) {
  const {active = true, debounce = false, onConnected, ...restOptions} = options
  assertNoUnknownOptions(restOptions)

  const classModel = typeof modelClassOrModels === "function" ? modelClassOrModels : null
  const instanceModels = typeof modelClassOrModels === "function" ? null : modelClassOrModels

  useModelClassEvent(classModel, "destroy", callback, {active: active && Boolean(classModel), debounce, onConnected})
  useInstanceDestroyedEvent(instanceModels, callback, {active: active && !classModel, debounce, onConnected})
}

/**
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @param {FrontendModelDestroyEventCallback} callback - Event callback.
 * @param {UseDestroyedEventOptions} options - Hook options.
 * @returns {void}
 */
function useInstanceDestroyedEvent(modelOrModels, callback, options) {
  const {active = true, debounce = false, onConnected} = options
  const callbackRef = useRef(callback)
  const activeRef = useRef(active)
  callbackRef.current = callback
  activeRef.current = active

  const modelsKey = modelsDependencyKey(modelOrModels)
  const eventCallback = useMemo(() => {
    const wrappedCallback = (/** @type {FrontendModelInstanceDestroyEventPayload} */ payload) => {
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
    const subscriptionCallback = (/** @type {FrontendModelInstanceDestroyEventPayload} */ payload) => {
      if (!closed) eventCallback(payload)
    }

    void (async () => {
      for (const model of models) {
        const unsubscribe = await model.onDestroy(subscriptionCallback)

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

      clearPendingDebouncedCallback(eventCallback)
    }
  }, [active, eventCallback, modelsKey, onConnected])
}
