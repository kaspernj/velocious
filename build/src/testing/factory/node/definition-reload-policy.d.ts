/**
 * Default maximum number of cache-busted factory definition import attempts a
 * single Node process may perform. Chosen conservatively from the
 * `factory-esm-reload-retention` benchmark evidence: each cache-busted import
 * retains roughly 6 KB of heap in Node's ESM module map, so the default bounds
 * retained definition modules to a few tens of MB before the owning process
 * must be recycled. This module is intentionally Node-only; browser-safe factory
 * code must never import it.
 */
export declare const DEFAULT_DEFINITION_RELOAD_BUDGET = 4096;
/**
 * Rejected when code tries to configure the process-global reload budget more
 * than once or after any valid cache-busted import reservation was attempted.
 * Retained ESM modules and their accounting live for the process lifetime, so
 * changing the budget can never begin a new in-process policy epoch.
 */
export declare class DefinitionReloadConfigurationError extends Error {
    budget: number;
    configured: boolean;
    current: number;
    requestedBudget: number;
    /**
     * Creates the error.
     * @param {object} args - Details.
     * @param {number} args.current - Cache-busted imports already reserved.
     * @param {number} args.budget - Active process-global import budget.
     * @param {number} args.requestedBudget - Rejected replacement budget.
     * @param {boolean} args.configured - Whether an explicit budget was already configured.
     */
    constructor({ budget, configured, current, requestedBudget }: {
        current: number;
        budget: number;
        requestedBudget: number;
        configured: boolean;
    });
}
/**
 * Rejected when a reload would push the process over its cache-busted import
 * budget. The rejection happens synchronously before any registry reset or
 * import, so the currently loaded registry stays usable. Node never evicts
 * retained ESM module instances, so only recycling/restarting the owning Node
 * process reclaims the memory and refreshes edited dependency modules.
 */
export declare class DefinitionRecycleRequiredError extends Error {
    current: number;
    budget: number;
    requested: number;
    /**
     * Creates the error.
     * @param {object} args - Details.
     * @param {number} args.current - Cache-busted import attempts already reserved in this process.
     * @param {number} args.budget - Process-global import budget.
     * @param {number} args.requested - Import attempts the rejected reload needed.
     */
    constructor({ current, budget, requested }: {
        current: number;
        budget: number;
        requested: number;
    });
}
/**
 * Returns the process-global cache-busted import budget.
 * @returns {number} - The budget.
 */
export declare function getDefinitionReloadBudget(): number;
/**
 * Reads the cache-busted import attempts reserved so far in this process,
 * across every registry and target. Combined with {@link getDefinitionReloadBudget}
 * this is the deterministic process-global census for the recycle policy.
 * @returns {number} - Reserved count.
 */
export declare function peekDefinitionReloadBudget(): number;
/**
 * Configures the one process-global import budget exactly once and only before
 * the first valid reservation attempt. There is exactly one budget for the whole
 * process, so no combination of registries or targets can create independent
 * budgets that defeat the global limit. Retained-import accounting is never
 * reset in-process.
 * @param {number} budget - New budget.
 * @returns {void}
 */
export declare function setDefinitionReloadBudget(budget: number): void;
/**
 * Preflights and reserves a whole reload batch synchronously. Malformed counts
 * are rejected before configuration is sealed or accounting changes. Every valid
 * request, including zero and a rejected over-budget request, seals configuration
 * before capacity is evaluated. Throws {@link DefinitionRecycleRequiredError}
 * when the requested batch would push the process over its budget. The check and
 * reservation run in one synchronous step, so concurrent reloads cannot race past
 * the budget. The reservation is deliberately conservative: it covers every
 * import attempt in the batch, so a mid-batch import failure still counts its
 * attempts as retained modules.
 * @param {number} requested - Cache-busted import attempts the reload will perform.
 * @returns {void}
 */
export declare function reserveDefinitionReloadBudget(requested: number): void;
//# sourceMappingURL=definition-reload-policy.d.ts.map