// @ts-check

import debounceFunction from "debounce"
import {useEffect, useMemo, useRef} from "react"

import clearPendingDebouncedCallback from "./clear-pending-debounced-callback.js"

/**
 * FrontendModelClass type.
  @typedef {import("./base.js").FrontendModelClass} FrontendModelClass */
/**
 * FrontendModelInstance type.
  @typedef {InstanceType<FrontendModelClass>} FrontendModelInstance */
/**
 * FrontendModelClassEventName type.
  @typedef {"create" | "update" | "destroy"} FrontendModelClassEventName */
/**
 * Defines this typedef.
  @typedef {{id: string, model: FrontendModelInstance}} FrontendModelCreateUpdateEventPayload */
/**
 * Defines this typedef.
  @typedef {{id: string}} FrontendModelDestroyEventPayload */
/**
 * FrontendModelClassEventPayload type.
  @typedef {FrontendModelCreateUpdateEventPayload | FrontendModelDestroyEventPayload} FrontendModelClassEventPayload */
/**
 * FrontendModelClassEventCallback type.
  @typedef {(payload: FrontendModelClassEventPayload) => void} FrontendModelClassEventCallback */
/**
 * Defines this typedef.
  @typedef {{active?: boolean, debounce?: boolean | number, onConnected?: () => void} & import("./query.js").FrontendModelEventOptionsObject} UseModelClassEventOptions */

/**
 * Runs assert no unknown options.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue | (() => void) | undefined>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
  const unknownOptionNames = Object.keys(restOptions)

  if (unknownOptionNames.length > 0) {
    throw new Error(`Unknown options given to useModelClassEvent: ${unknownOptionNames.join(", ")}`)
  }
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
 * Runs normalize event names.
 * @param {FrontendModelClassEventName | FrontendModelClassEventName[]} eventOrEvents - Event name or names.
 * @returns {FrontendModelClassEventName[]} - Normalized event names.
 */
function normalizeEventNames(eventOrEvents) {
  return Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]
}

/**
 * Runs event names dependency key.
 * @param {FrontendModelClassEventName[]} eventNames - Event names.
 * @returns {string} - Stable dependency key.
 */
function eventNamesDependencyKey(eventNames) {
  return eventNames.join("|")
}

/**
 * Runs subscribe to model class event.
 * @param {FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelClassEventName} eventName - Event name.
 * @param {FrontendModelClassEventCallback} callback - Event callback.
 * @param {import("./query.js").FrontendModelEventOptionsObject} options - Event query or record projection options.
 * @returns {Promise<() => void>} - Unsubscribe callback.
 */
async function subscribeToModelClassEvent(modelClass, eventName, callback, options) {
  if (eventName === "create") return await modelClass.onCreate(callback, options)
  if (eventName === "update") return await modelClass.onUpdate(callback, options)
  if (eventName === "destroy") return await modelClass.onDestroy(callback, options)

  throw new Error(`Unsupported frontend model class event: ${eventName}`)
}

/**
 * React hook for frontend-model class lifecycle events.
 * @param {FrontendModelClass | null | undefined} modelClass - Frontend model class.
 * @param {FrontendModelClassEventName | FrontendModelClassEventName[]} eventOrEvents - Event name or names.
 * @param {FrontendModelClassEventCallback} callback - Event callback.
 * @param {UseModelClassEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useModelClassEvent(modelClass, eventOrEvents, callback, options = {}) {
  const {active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount, ...restOptions} = options
  assertNoUnknownOptions(restOptions)

  const projectionKey = JSON.stringify({abilities, preload, query: eventQueryDependencyPayload(query), queryData, select, selectsExtra, withCount})
  const projectionOptionsRef = useRef({abilities, preload, query, queryData, select, selectsExtra, withCount})
  const callbackRef = useRef(callback)
  const activeRef = useRef(active)
  projectionOptionsRef.current = {abilities, preload, query, queryData, select, selectsExtra, withCount}
  callbackRef.current = callback
  activeRef.current = active

  const eventNames = normalizeEventNames(eventOrEvents)
  const eventsKey = eventNamesDependencyKey(eventNames)
  const eventCallback = useMemo(() => {
    const wrappedCallback = (/**
                              * Narrows the runtime value to the documented type.
                               @type {FrontendModelClassEventPayload} */ payload) => {
      if (activeRef.current) callbackRef.current(payload)
    }

    if (typeof debounce === "number") return debounceFunction(wrappedCallback, debounce)
    if (debounce) return debounceFunction(wrappedCallback)

    return wrappedCallback
  }, [debounce])

  useEffect(() => {
    if (!active || !modelClass) return undefined

    let closed = false
    /**
     * Unsubscribe callbacks.
      @type {Array<() => void>} */
    const unsubscribeCallbacks = []
    const subscriptionCallback = (/**
                                   * Narrows the runtime value to the documented type.
                                    @type {FrontendModelClassEventPayload} */ payload) => {
      if (!closed) eventCallback(payload)
    }

    void (async () => {
      for (const eventName of eventNames) {
        const unsubscribe = await subscribeToModelClassEvent(modelClass, eventName, subscriptionCallback, projectionOptionsRef.current)

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
  }, [active, eventsKey, eventCallback, modelClass, onConnected, projectionKey])
}
