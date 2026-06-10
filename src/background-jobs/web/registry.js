// @ts-check

/**
 * JobsMountOptions type.
 * @typedef {object} JobsMountOptions
 * @property {(args: {request: import("../../http-server/client/request.js").default, ability: (import("../../authorization/ability.js").default | undefined), token: (string | null), configuration: import("../../configuration.js").default}) => (boolean | void | Promise<boolean | void>)} [authorize] - Authorization callback. Return true to allow the request.
 * @property {string[]} [accessTokens] - Bearer tokens accepted for cross-origin/native access.
 * @property {string[]} [allowedOrigins] - Origins allowed for cross-origin browser access.
 * @property {boolean} [redactArgs] - When true, job arguments are omitted from API responses.
 * @property {string} [databaseIdentifier] - Database identifier the jobs store reads from.
 */

/**
 * Mount options are keyed by configuration so multiple configurations (e.g.
 * across tests) never share state, and by mount path so a single configuration
 * can mount the dashboard at more than one prefix. Functions in the options
 * (the `authorize` callback) can't travel through route params, so the
 * controller looks them up here using the plain `at` string it receives.
 * @type {WeakMap<import("../../configuration.js").default, Map<string, JobsMountOptions>>}
 */
const registry = new WeakMap()

/**
 * Documents this API.
 * @param {import("../../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @param {JobsMountOptions} options - Mount options.
 * @returns {void} - No return value.
 */
export function registerJobsMount(configuration, at, options) {
  let byPath = registry.get(configuration)

  if (!byPath) {
    byPath = new Map()
    registry.set(configuration, byPath)
  }

  byPath.set(at, options)
}

/**
 * Documents this API.
 * @param {import("../../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @returns {JobsMountOptions | undefined} - Mount options if registered.
 */
export function getJobsMount(configuration, at) {
  return registry.get(configuration)?.get(at)
}
