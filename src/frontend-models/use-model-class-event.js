// @ts-check

import debounceFunction from "debounce"
import {useEffect, useMemo, useRef} from "react"

/** @typedef {typeof import("./base.js").default} FrontendModelClass */
/** @typedef {InstanceType<FrontendModelClass>} FrontendModelInstance */
/** @typedef {"create" | "update" | "destroy"} FrontendModelClassEventName */
/** @typedef {{id: string, model: FrontendModelInstance}} FrontendModelCreateUpdateEventPayload */
/** @typedef {{id: string}} FrontendModelDestroyEventPayload */
/** @typedef {FrontendModelCreateUpdateEventPayload | FrontendModelDestroyEventPayload} FrontendModelClassEventPayload */
/** @typedef {(payload: FrontendModelClassEventPayload) => void} FrontendModelClassEventCallback */
/** @typedef {{active?: boolean, debounce?: boolean | number, onConnected?: () => void}} UseModelClassEventOptions */

/**
 * @param {FrontendModelClassEventName | FrontendModelClassEventName[]} eventOrEvents - Event name or names.
 * @returns {FrontendModelClassEventName[]} - Normalized event names.
 */
function normalizeEventNames(eventOrEvents) {
  return Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]
}

/**
 * @param {FrontendModelClassEventName[]} eventNames - Event names.
 * @returns {string} - Stable dependency key.
 */
function eventNamesDependencyKey(eventNames) {
  return eventNames.join("|")
}

/**
 * @param {Record<string, unknown>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
  const unknownOptionNames = Object.keys(restOptions)

  if (unknownOptionNames.length > 0) {
    throw new Error(`Unknown options given to useModelClassEvent: ${unknownOptionNames.join(", ")}`)
  }
}

/**
 * @param {FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelClassEventName} eventName - Event name.
 * @param {FrontendModelClassEventCallback} callback - Event callback.
 * @returns {Promise<() => void>} - Unsubscribe callback.
 */
async function subscribeToModelClassEvent(modelClass, eventName, callback) {
  if (eventName === "create") return await modelClass.onCreate(callback)
  if (eventName === "update") return await modelClass.onUpdate(callback)
  if (eventName === "destroy") return await modelClass.onDestroy(callback)

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
  const {active = true, debounce = false, onConnected, ...restOptions} = options
  assertNoUnknownOptions(restOptions)

  const callbackRef = useRef(callback)
  const activeRef = useRef(active)
  callbackRef.current = callback
  activeRef.current = active

  const eventNames = normalizeEventNames(eventOrEvents)
  const eventsKey = eventNamesDependencyKey(eventNames)
  const eventCallback = useMemo(() => {
    const wrappedCallback = (/** @type {FrontendModelClassEventPayload} */ payload) => {
      if (activeRef.current) callbackRef.current(payload)
    }

    if (typeof debounce === "number") return debounceFunction(wrappedCallback, debounce)
    if (debounce) return debounceFunction(wrappedCallback)

    return wrappedCallback
  }, [debounce])

  useEffect(() => {
    if (!active || !modelClass) return undefined

    let closed = false
    /** @type {Array<() => void>} */
    const unsubscribeCallbacks = []

    void (async () => {
      for (const eventName of eventNames) {
        const unsubscribe = await subscribeToModelClassEvent(modelClass, eventName, eventCallback)

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
  }, [active, eventsKey, eventCallback, modelClass, onConnected])
}
