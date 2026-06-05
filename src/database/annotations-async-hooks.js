// @ts-check

import {AsyncLocalStorage} from "node:async_hooks"

/** @type {import("node:async_hooks").AsyncLocalStorage<string[]> | undefined} */
let asyncLocalStorage

/** @type {typeof globalThis & {velociousDatabaseAnnotations?: {getDatabaseAnnotations: () => string[], withDatabaseAnnotation: (annotation: string, callback: () => Promise<unknown>) => Promise<unknown>}}} */
const databaseAnnotationsGlobal = globalThis

if (AsyncLocalStorage) {
  asyncLocalStorage = new AsyncLocalStorage()
}

/** @returns {string[]} - Active database annotations for the current async context. */
function getDatabaseAnnotations() {
  return asyncLocalStorage?.getStore() || []
}

/**
 * Runs the callback with an annotation that is appended to database query comments.
 * @param {string} annotation - Human-readable annotation for queries executed inside the callback.
 * @param {() => Promise<unknown>} callback - Callback to execute inside the annotation context.
 * @returns {Promise<unknown>} - Resolves with the callback result.
 */
async function withDatabaseAnnotation(annotation, callback) {
  if (!asyncLocalStorage) return await callback()

  const parentAnnotations = asyncLocalStorage.getStore() || []

  return await asyncLocalStorage.run([...parentAnnotations, annotation], async () => {
    return await callback()
  })
}

if (databaseAnnotationsGlobal.velociousDatabaseAnnotations) {
  console.warn("globalThis.velociousDatabaseAnnotations was already defined")
} else {
  databaseAnnotationsGlobal.velociousDatabaseAnnotations = {getDatabaseAnnotations, withDatabaseAnnotation}
}
