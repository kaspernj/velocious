// @ts-check

/**
 * Default maximum number of cache-busted factory definition import attempts a
 * single Node process may perform. Chosen conservatively from the
 * `factory-esm-reload-retention` benchmark evidence: each cache-busted import
 * retains roughly 6 KB of heap in Node's ESM module map, so the default bounds
 * retained definition modules to a few tens of MB before the owning process
 * must be recycled. This module is intentionally Node-only; browser-safe factory
 * code must never import it.
 */
export const DEFAULT_DEFINITION_RELOAD_BUDGET = 4096

/**
 * Rejected when code tries to configure the process-global reload budget more
 * than once or after cache-busted imports have already been reserved. Retained
 * ESM modules and their accounting live for the process lifetime, so changing
 * the budget can never begin a new in-process policy epoch.
 */
export class DefinitionReloadConfigurationError extends Error {
  /**
   * Creates the error.
   * @param {object} args - Details.
   * @param {number} args.current - Cache-busted imports already reserved.
   * @param {number} args.budget - Active process-global import budget.
   * @param {number} args.requestedBudget - Rejected replacement budget.
   * @param {boolean} args.configured - Whether an explicit budget was already configured.
   */
  constructor({budget, configured, current, requestedBudget}) {
    const reason = configured
      ? "the process-global definition reload budget was already configured"
      : "cache-busted definition imports were already reserved"

    super(`Cannot configure definition reload budget to ${requestedBudget}: ${reason} (current=${current}, budget=${budget}). Configuration is allowed exactly once before the first reservation; only process exit resets retained-module accounting.`)
    this.name = "DefinitionReloadConfigurationError"
    this.budget = budget
    this.configured = configured
    this.current = current
    this.requestedBudget = requestedBudget
  }
}

/**
 * Rejected when a reload would push the process over its cache-busted import
 * budget. The rejection happens synchronously before any registry reset or
 * import, so the currently loaded registry stays usable. Node never evicts
 * retained ESM module instances, so only recycling/restarting the owning Node
 * process reclaims the memory and refreshes edited dependency modules.
 */
export class DefinitionRecycleRequiredError extends Error {
  /**
   * Creates the error.
   * @param {object} args - Details.
   * @param {number} args.current - Cache-busted import attempts already reserved in this process.
   * @param {number} args.budget - Process-global import budget.
   * @param {number} args.requested - Import attempts the rejected reload needed.
   */
  constructor({current, budget, requested}) {
    super(`Factory definition reload import budget exhausted (current=${current}, budget=${budget}, requested=${requested}). Recycle or restart the owning Node process: every reload imports a fresh cache-busted module instance and Node never evicts them, so process recycling is the only reclamation boundary.`)
    this.name = "DefinitionRecycleRequiredError"
    this.current = current
    this.budget = budget
    this.requested = requested
  }
}

/** @type {number} - The single process-global import budget. */
let importBudget = DEFAULT_DEFINITION_RELOAD_BUDGET

/** @type {number} - Cache-busted import attempts reserved so far across every registry and target. */
let reservedImports = 0

/** @type {boolean} - Whether the process-global budget was explicitly configured. */
let budgetConfigured = false

/** @type {boolean} - Whether any complete reload batch has been reserved. */
let reservationStarted = false

/**
 * Returns the process-global cache-busted import budget.
 * @returns {number} - The budget.
 */
export function getDefinitionReloadBudget() {
  return importBudget
}

/**
 * Reads the cache-busted import attempts reserved so far in this process,
 * across every registry and target. Combined with {@link getDefinitionReloadBudget}
 * this is the deterministic process-global census for the recycle policy.
 * @returns {number} - Reserved count.
 */
export function peekDefinitionReloadBudget() {
  return reservedImports
}

/**
 * Configures the one process-global import budget exactly once and only before
 * the first reservation. There is exactly one budget for the whole process, so
 * no combination of registries or targets can create independent budgets that
 * defeat the global limit. Retained-import accounting is never reset in-process.
 * @param {number} budget - New budget.
 * @returns {void}
 */
export function setDefinitionReloadBudget(budget) {
  if (!Number.isInteger(budget) || budget < 1) {
    throw new TypeError(`Definition reload budget must be a positive integer, got ${JSON.stringify(budget)}`)
  }

  if (budgetConfigured || reservationStarted) {
    throw new DefinitionReloadConfigurationError({
      budget: importBudget,
      configured: budgetConfigured,
      current: reservedImports,
      requestedBudget: budget
    })
  }

  importBudget = budget
  budgetConfigured = true
}

/**
 * Preflights and reserves a whole reload batch synchronously. Throws
 * {@link DefinitionRecycleRequiredError} when the requested batch would push the
 * process over its budget. The check and reservation run in one synchronous
 * step, so concurrent reloads cannot race past the budget. The reservation is
 * deliberately conservative: it covers every import attempt in the batch, so a
 * mid-batch import failure still counts its attempts as retained modules.
 * @param {number} requested - Cache-busted import attempts the reload will perform.
 * @returns {void}
 */
export function reserveDefinitionReloadBudget(requested) {
  if (reservedImports + requested > importBudget) {
    throw new DefinitionRecycleRequiredError({current: reservedImports, budget: importBudget, requested})
  }

  reservationStarted = true
  reservedImports += requested
}
