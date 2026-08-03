// @ts-check

import VelociousDeploymentApiController from "./controller.js"
import {matchDeploymentApiPath} from "./path-matcher.js"
import {normalizeMountPrefix} from "../utils/mount-prefix.js"
import {registerDeploymentMount} from "./registry.js"

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const MAX_IDENTIFIER_LENGTH = 64
const BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/

/**
 * Validates one allowlist identifier (project or stage). Bounded identifiers
 * keep every value the API handles safe to pass to the adapter as data.
 * @param {?} value - Raw identifier.
 * @param {string} name - Human-readable name for error messages.
 * @returns {string} - The validated identifier.
 */
function validateIdentifier(value, name) {
  if (typeof value !== "string" || value.length > MAX_IDENTIFIER_LENGTH || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${name} identifier: ${String(value)}`)
  }

  return value
}

/**
 * Validates the projects allowlist and returns a normalized copy.
 * @param {?} projects - Raw projects option.
 * @returns {Record<string, import("./registry.js").DeploymentProjectOptions>} - Normalized allowlist.
 */
function validateProjects(projects) {
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    throw new Error("VelociousDeploymentApi requires a 'projects' allowlist object")
  }

  // Null-prototype maps so request-controlled names like "__proto__" or
  // "constructor" can never resolve inherited properties as allowlisted
  // projects/stages.
  /** @type {Record<string, import("./registry.js").DeploymentProjectOptions>} */
  const normalized = Object.create(null)

  for (const [project, projectOptions] of Object.entries(projects)) {
    validateIdentifier(project, "project")

    const stages = /** @type {Record<string, ?>} */ (projectOptions)?.stages

    if (!stages || typeof stages !== "object" || Array.isArray(stages) || Object.keys(stages).length === 0) {
      throw new Error(`Project ${project} must allowlist at least one stage`)
    }

    /** @type {Record<string, import("./registry.js").DeploymentStageOptions>} */
    const normalizedStages = Object.create(null)

    for (const [stage, stageOptions] of Object.entries(stages)) {
      validateIdentifier(stage, "stage")

      const releaseBranch = /** @type {Record<string, ?>} */ (stageOptions)?.releaseBranch

      if (typeof releaseBranch !== "string" || !BRANCH_PATTERN.test(releaseBranch) || releaseBranch.includes("..")) {
        throw new Error(`Invalid release branch for ${project}/${stage}: ${String(releaseBranch)}`)
      }

      normalizedStages[stage] = {releaseBranch}
    }

    normalized[project] = {stages: normalizedStages}
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error("VelociousDeploymentApi requires at least one allowlisted project")
  }

  return normalized
}

/**
 * Validates the adapter contract so misconfiguration fails at boot rather than
 * on the first request.
 * @param {?} adapter - Raw adapter option.
 * @returns {import("./registry.js").DeploymentAdapter} - The validated adapter.
 */
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error("VelociousDeploymentApi requires an 'adapter' object")
  }

  const candidate = /** @type {Record<string, ?>} */ (adapter)

  for (const methodName of ["validateRevision", "deploy"]) {
    if (typeof candidate[methodName] !== "function") {
      throw new TypeError(`VelociousDeploymentApi adapter must respond to ${methodName}()`)
    }
  }

  if (candidate.readStatus !== undefined && typeof candidate.readStatus !== "function") {
    throw new TypeError("VelociousDeploymentApi adapter readStatus must be a function when given")
  }

  return /** @type {import("./registry.js").DeploymentAdapter} */ (adapter)
}

/**
 * Validates the access tokens. The API fails closed: without at least one
 * configured token every request is unauthorized, so mounting without tokens
 * is a configuration error.
 * @param {?} accessTokens - Raw access tokens option.
 * @returns {string[]} - The validated tokens.
 */
function validateAccessTokens(accessTokens) {
  if (!Array.isArray(accessTokens)) {
    throw new Error("VelociousDeploymentApi requires an 'accessTokens' array with at least one token")
  }

  for (const token of accessTokens) {
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("VelociousDeploymentApi access tokens must all be non-empty strings")
    }
  }

  if (accessTokens.length === 0) {
    throw new Error("VelociousDeploymentApi requires at least one non-empty access token; the API fails closed without one")
  }

  return [...accessTokens]
}

const DEFAULT_STALE_RUN_TIMEOUT_MS = 60000

/**
 * Validates the stale-run lease timeout: after this many milliseconds without
 * an ownership heartbeat, a later request reconciles pending work as
 * interrupted and running work as requiring operator reconciliation.
 * @param {?} value - Raw option value.
 * @returns {number} - The timeout in milliseconds.
 */
function validateStaleRunTimeoutMs(value) {
  if (value === undefined) return DEFAULT_STALE_RUN_TIMEOUT_MS

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`VelociousDeploymentApi staleRunTimeoutMs must be a positive integer, got: ${String(value)}`)
  }

  return value
}

/**
 * Mountable authenticated deployment API. A narrowly configured consumer
 * mounts it in its routes file and supplies an adapter owned by the deployment
 * integration (e.g. Rampway) that performs the actual lock/build/release/
 * health/rollback/cleanup work:
 *
 * ```js
 * routes.draw((route) => {
 *   route.mount(VelociousDeploymentApi, {
 *     at: "/velocious/deployments",
 *     accessTokens: [secrets.deploymentApiToken],
 *     adapter: rampwayDeploymentAdapter,
 *     projects: {
 *       "my-app": {stages: {production: {releaseBranch: "master"}}}
 *     }
 *   })
 * })
 * ```
 */
export default class VelociousDeploymentApi {
  /**
   * Registers the deployment API under `at`. Implemented as a route-resolver
   * hook so the controller can live inside the velocious package rather than
   * the host app's `src/routes` directory. Invoked by the routing layer for
   * each `route.mount(...)` registration.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.at - Mount path prefix (e.g. "/velocious/deployments").
   * @param {string[]} args.accessTokens - Accepted bearer tokens; requests authenticate with `Authorization: Bearer <token>` only.
   * @param {import("./registry.js").DeploymentAdapter} args.adapter - Deployment integration adapter that owns execution.
   * @param {Record<string, import("./registry.js").DeploymentProjectOptions>} args.projects - Allowlisted projects/stages with their approved release branches.
   * @param {string} [args.databaseIdentifier] - Database identifier the run store reads from.
   * @param {number} [args.staleRunTimeoutMs] - Lease timeout after which an active run without a heartbeat is reconciled according to its execution state; defaults to 60000.
   * @returns {void} - No return value.
   */
  static mountInto({accessTokens, adapter, at, configuration, databaseIdentifier, projects, staleRunTimeoutMs}) {
    if (!configuration) throw new Error("No configuration given")

    const prefix = normalizeMountPrefix(at)
    const options = {
      accessTokens: validateAccessTokens(accessTokens),
      adapter: validateAdapter(adapter),
      databaseIdentifier,
      projects: validateProjects(projects),
      staleRunTimeoutMs: validateStaleRunTimeoutMs(staleRunTimeoutMs)
    }

    registerDeploymentMount(configuration, prefix, options)

    configuration.addRouteResolverHook(({currentPath, request}) => {
      const match = matchDeploymentApiPath({method: request.httpMethod(), path: currentPath, prefix})

      if (!match) return null

      return {
        action: match.action,
        controller: "velociousDeploymentApi",
        controllerClass: VelociousDeploymentApiController,
        params: {...match.params, velociousDeploymentMountAt: prefix}
      }
    })
  }
}
