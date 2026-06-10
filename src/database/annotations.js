// @ts-check

/**
 * Documents this API.
 * @typedef {{getDatabaseAnnotations?: () => string[], withDatabaseAnnotation?: (annotation: string, callback: () => Promise<?>) => Promise<?>}} DatabaseAnnotationsRuntime */
/**
 * Database annotations global.
 * @type {typeof globalThis & {velociousDatabaseAnnotations?: DatabaseAnnotationsRuntime}} */
const databaseAnnotationsGlobal = globalThis

/**
 * Runs get database annotations.
 * @returns {string[]} - Active database annotations for the current async context. */
function getDatabaseAnnotations() {
  const runtime = databaseAnnotationsGlobal.velociousDatabaseAnnotations

  if (!runtime || !runtime.getDatabaseAnnotations) return []

  return runtime.getDatabaseAnnotations()
}

/**
 * Runs the callback with an annotation that is appended to database query comments.
 * @template T
 * @param {string} annotation - Human-readable annotation for queries executed inside the callback.
 * @param {() => Promise<T>} callback - Callback to execute inside the annotation context.
 * @returns {Promise<T>} - Resolves with the callback result.
 */
async function withDatabaseAnnotation(annotation, callback) {
  const runtime = databaseAnnotationsGlobal.velociousDatabaseAnnotations

  if (runtime && runtime.withDatabaseAnnotation) {
    return /** Documents this API. @type {T} */ (await runtime.withDatabaseAnnotation(annotation, callback))
  }

  return await callback()
}

export {getDatabaseAnnotations, withDatabaseAnnotation}
