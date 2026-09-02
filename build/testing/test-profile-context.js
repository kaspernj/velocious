// @ts-check

/** @type {WeakMap<import("../configuration.js").default, () => import("./test-profiler.js").TestProfileAsyncContext | undefined>} */
const profileContextReaders = new WeakMap()

/**
 * Enables profile-context lookup for one configuration only when a collector exists.
 * @param {import("../configuration.js").default} configuration - Configuration identity.
 * @param {() => import("./test-profiler.js").TestProfileAsyncContext | undefined} reader - Async-context reader.
 * @returns {void}
 */
export function registerTestProfileContextReader(configuration, reader) {
  profileContextReaders.set(configuration, reader)
}

/**
 * Gets an active profile context without requiring configuration doubles to
 * implement profiling APIs and without reading async context in normal runs.
 * @param {import("../configuration.js").default} configuration - Configuration identity.
 * @returns {import("./test-profiler.js").TestProfileAsyncContext | undefined} - Active context.
 */
export function currentTestProfileContext(configuration) {
  const reader = profileContextReaders.get(configuration)

  if (!reader) return undefined

  return reader()
}
