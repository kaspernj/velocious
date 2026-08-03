// @ts-check

/**
 * DeploymentAdapter type. The configured deployment integration (e.g. Rampway)
 * owns the implementation; Velocious only calls this contract. All values are
 * passed as data — the framework never builds commands, paths, or refs.
 * @typedef {object} DeploymentAdapter
 * @property {(args: {configuration: import("../configuration.js").default, project: string, releaseBranch: string, revision: string, stage: string}) => Promise<boolean>} validateRevision - Returns whether the full revision is reachable from the approved release branch.
 * @property {(args: {configuration: import("../configuration.js").default, project: string, releaseBranch: string, revision: string, runId: string, stage: string}) => Promise<Record<string, ?>>} deploy - Runs the integration's normal lock/build/migrate/release/health/rollback/cleanup deploy. The report shape is integration-owned and gets JSON-sanitized and redacted before persistence.
 * @property {(args: {configuration: import("../configuration.js").default, project: string, stage: string}) => Promise<Record<string, ?>>} [readStatus] - Optional bounded readback of the live release (active revision, current/previous release).
 */

/**
 * DeploymentStageOptions type.
 * @typedef {object} DeploymentStageOptions
 * @property {string} releaseBranch - Approved release branch the requested revision must be reachable from.
 */

/**
 * DeploymentProjectOptions type.
 * @typedef {object} DeploymentProjectOptions
 * @property {Record<string, DeploymentStageOptions>} stages - Allowlisted stages keyed by identifier.
 */

/**
 * DeploymentMountOptions type.
 * @typedef {object} DeploymentMountOptions
 * @property {string[]} accessTokens - Accepted bearer tokens (required, fail closed when empty).
 * @property {DeploymentAdapter} adapter - Deployment integration adapter that owns execution.
 * @property {Record<string, DeploymentProjectOptions>} projects - Allowlisted projects keyed by identifier (null-prototype map).
 * @property {string} [databaseIdentifier] - Database identifier the run store reads from.
 * @property {number} staleRunTimeoutMs - Lease timeout after which an active run without a heartbeat is reconciled according to its execution state.
 */

/**
 * Mount options are keyed by configuration so multiple configurations (e.g.
 * across tests) never share state, and by mount path so a single configuration
 * can mount the API at more than one prefix. Functions in the options (the
 * adapter) can't travel through route params, so the controller looks them up
 * here using the plain `at` string it receives.
 * @type {WeakMap<import("../configuration.js").default, Map<string, DeploymentMountOptions>>}
 */
const registry = new WeakMap()

/**
 * Registers mount options for a configuration and mount path.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @param {DeploymentMountOptions} options - Mount options.
 * @returns {void} - No return value.
 */
export function registerDeploymentMount(configuration, at, options) {
  let byPath = registry.get(configuration)

  if (!byPath) {
    byPath = new Map()
    registry.set(configuration, byPath)
  }

  byPath.set(at, options)
}

/**
 * Returns the mount options for a configuration and mount path.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @returns {DeploymentMountOptions | undefined} - Mount options if registered.
 */
export function getDeploymentMount(configuration, at) {
  return registry.get(configuration)?.get(at)
}
