// @ts-check

import debounceFunction from "debounce"
import {useEffect, useMemo, useRef} from "react"

import clearPendingDebouncedCallback from "./clear-pending-debounced-callback.js"
import {modelsDependencyKey, modelsFromInput} from "./event-hook-models.js"
import useModelClassEvent from "./use-model-class-event.js"

/**
 * FrontendModelClass type.
  @typedef {typeof import("./base.js").default} FrontendModelClass */
/**
 * FrontendModelInstance type.
  @typedef {import("./base.js").default} FrontendModelInstance */
/**
 * FrontendModelClassDestroyEventPayload type.
  @typedef {import("./use-model-class-event.js").FrontendModelDestroyEventPayload} FrontendModelClassDestroyEventPayload */
/**
 * Defines this typedef.
  @typedef {{id: string}} FrontendModelInstanceDestroyEventPayload */
/**
 * FrontendModelDestroyEventPayload type.
  @typedef {FrontendModelClassDestroyEventPayload | FrontendModelInstanceDestroyEventPayload} FrontendModelDestroyEventPayload */
/**
 * UseDestroyedEventOptions type.
  @typedef {import("./use-model-class-event.js").UseModelClassEventOptions} UseDestroyedEventOptions */
/**
 * FrontendModelDestroyEventCallback type.
  @typedef {(payload: FrontendModelDestroyEventPayload) => void} FrontendModelDestroyEventCallback */

/**
 * Runs assert no unknown options.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue | (() => void) | undefined>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
  const unknownOptionNames = Object.keys(restOptions)

  if (unknownOptionNames.length === 0) return

  throw new Error(`Unknown options given to useDestroyedEvent: ${unknownOptionNames.join(", ")}`)
}

/**
 * Runs event query dependency payload.
 * @param {import("./query.js").default<FrontendModelClass> | undefined} query - Event query option.
 * @returns {import("./query.js").FrontendModelEventOptionsPayload | null} Stable dependency payload.
 */
function eventQueryDependencyPayload(query) {
  if (!query) return null

  return query.eventOptionsPayload()
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
  const {active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount, ...restOptions} = options
  assertNoUnknownOptions(restOptions)

  const classModel = typeof modelClassOrModels === "function" ? modelClassOrModels : null
  const instanceModels = typeof modelClassOrModels === "function" ? null : modelClassOrModels
  const projectionOptions = {abilities, preload, query, queryData, select, selectsExtra, withCount}

  useModelClassEvent(classModel, "destroy", callback, {active: active && Boolean(classModel), debounce, onConnected, ...projectionOptions})
  useInstanceDestroyedEvent(instanceModels, callback, {active: active && !classModel, debounce, onConnected, ...projectionOptions})
}

/**
 * Runs use instance destroyed event.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @param {FrontendModelDestroyEventCallback} callback - Event callback.
 * @param {UseDestroyedEventOptions} options - Hook options.
 * @returns {void}
 */
function useInstanceDestroyedEvent(modelOrModels, callback, options) {
  const {active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount} = options
  const projectionKey = JSON.stringify({abilities, preload, query: eventQueryDependencyPayload(query), queryData, select, selectsExtra, withCount})
  const projectionOptionsRef = useRef({abilities, preload, query, queryData, select, selectsExtra, withCount})
  const callbackRef = useRef(callback)
  const activeRef = useRef(active)
  projectionOptionsRef.current = {abilities, preload, query, queryData, select, selectsExtra, withCount}
  callbackRef.current = callback
  activeRef.current = active

  const modelsKey = modelsDependencyKey(modelOrModels)
  const eventCallback = useMemo(() => {
    const wrappedCallback = (/**
                              * Narrows the runtime value to the documented type.
                               @type {FrontendModelInstanceDestroyEventPayload} */ payload) => {
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
    /**
     * Unsubscribe callbacks.
      @type {Array<() => void>} */
    const unsubscribeCallbacks = []
    const subscriptionCallback = (/**
                                   * Narrows the runtime value to the documented type.
                                    @type {FrontendModelInstanceDestroyEventPayload} */ payload) => {
      if (!closed) eventCallback(payload)
    }

    void (async () => {
      for (const model of models) {
        const unsubscribe = await model.onDestroy(subscriptionCallback, projectionOptionsRef.current)

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
  }, [active, eventCallback, modelsKey, onConnected, projectionKey])
}
