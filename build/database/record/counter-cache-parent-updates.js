// @ts-check

import Logger from "../../logger.js"
import {ensureError} from "typanic"

/** @typedef {(parent: import("./index.js").default, previousParent: import("./index.js").default | undefined) => void | Promise<void>} CounterCacheParentUpdateListener */
/** @typedef {{canonicalParentModelClass: typeof import("./index.js").default, listeners: CounterCacheParentUpdateListener[], parentId: ReturnType<typeof JSON.parse>, parentPrimaryKey: string, parentQuery: import("../query/model-class-query.js").default<typeof import("./index.js").default>, previousParent: import("./index.js").default | undefined}} PreparedCounterCacheParentUpdate */

/** @type {WeakMap<typeof import("./index.js").default, Set<CounterCacheParentUpdateListener>>} */
const listenersByParentModelClass = new WeakMap()

/**
 * Registers an internal listener for committed counter-cache parent updates.
 * @param {typeof import("./index.js").default} parentModelClass - Parent model class.
 * @param {CounterCacheParentUpdateListener} listener - Committed-parent listener.
 * @returns {() => void} - Listener removal callback.
 */
export function registerCounterCacheParentUpdateListener(parentModelClass, listener) {
  const canonicalParentModelClass = parentModelClass.canonicalRecordMetadataModelClass()
  let listeners = listenersByParentModelClass.get(canonicalParentModelClass)

  if (!listeners) {
    listeners = new Set()
    listenersByParentModelClass.set(canonicalParentModelClass, listeners)
  }

  listeners.add(listener)

  return () => listeners.delete(listener)
}

/**
 * Captures one counter-cache parent's pre-mutation state when listeners are registered.
 * @param {object} args - Parent update arguments.
 * @param {ReturnType<typeof JSON.parse>} args.parentId - Parent relationship identity.
 * @param {typeof import("./index.js").default} args.parentModelClass - Parent model class.
 * @param {string} args.parentPrimaryKey - Parent relationship primary key.
 * @param {import("../query/model-class-query.js").default<typeof import("./index.js").default>} args.parentQuery - Source-owned parent query.
 * @returns {Promise<PreparedCounterCacheParentUpdate | undefined>} - Prepared delivery, or undefined when no listener is registered.
 */
export async function prepareCounterCacheParentUpdate({parentId, parentModelClass, parentPrimaryKey, parentQuery}) {
  const canonicalParentModelClass = parentModelClass.canonicalRecordMetadataModelClass()
  const registeredListeners = listenersByParentModelClass.get(canonicalParentModelClass)

  if (!registeredListeners || registeredListeners.size == 0) return
  const previousParent = await parentQuery.findBy({[parentPrimaryKey]: parentId}) || undefined

  return {
    canonicalParentModelClass,
    listeners: [...registeredListeners],
    parentId,
    parentPrimaryKey,
    parentQuery,
    previousParent
  }
}

/**
 * Schedules one non-coalesced parent reload and notification on the source record's commit lifecycle.
 * @param {object} args - Parent update arguments.
 * @param {PreparedCounterCacheParentUpdate | undefined} args.preparedUpdate - Pre-mutation parent delivery state.
 * @param {import("./index.js").default} args.sourceRecord - Source record that owns the transaction lifecycle.
 * @returns {Promise<void>} - Resolves after registration or immediate delivery.
 */
export async function scheduleCounterCacheParentUpdate({preparedUpdate, sourceRecord}) {
  if (!preparedUpdate) return

  const {canonicalParentModelClass, listeners, parentId, parentPrimaryKey, parentQuery, previousParent} = preparedUpdate

  await sourceRecord.connection().afterCommit(async () => {
    let parent

    try {
      parent = await parentQuery.findBy({[parentPrimaryKey]: parentId})
    } catch (error) {
      await reportCounterCacheParentUpdateError(canonicalParentModelClass._getConfiguration(), error)
      return
    }

    if (!parent) return

    for (const listener of listeners) {
      try {
        await listener(parent, previousParent)
      } catch (error) {
        await reportCounterCacheParentUpdateError(parent._getConfiguration(), error)
      }
    }
  })
}

/**
 * Reports a post-commit delivery failure without rejecting the durable source operation.
 * @param {import("../../configuration.js").default} configuration - Owning configuration.
 * @param {ReturnType<typeof JSON.parse>} caughtError - Reload or listener failure.
 * @returns {Promise<void>} - Resolves after best-effort reporting.
 */
async function reportCounterCacheParentUpdateError(configuration, caughtError) {
  const error = ensureError(caughtError)
  const payload = {
    context: {stage: "counter-cache-parent-update-after-commit"},
    error
  }
  /** @type {ReturnType<typeof JSON.parse>[]} */
  const reportingErrors = []
  let errorEvents

  try {
    errorEvents = configuration.getErrorEvents()
  } catch (reportingError) {
    reportingErrors.push(reportingError)
  }

  if (errorEvents) {
    try {
      errorEvents.emit("framework-error", payload)
    } catch (reportingError) {
      reportingErrors.push(reportingError)
    }

    try {
      errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
    } catch (reportingError) {
      reportingErrors.push(reportingError)
    }
  }

  if (reportingErrors.length == 0) return

  try {
    const logger = new Logger("CounterCacheParentUpdates", {configuration})

    await logger.error("Counter-cache parent update error reporting failed", {error, reportingErrors})
  } catch {
    console.error("Counter-cache parent update error reporting failed")
  }
}
