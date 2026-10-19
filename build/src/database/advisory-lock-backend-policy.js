// @ts-check
/**
 * Advisory-lock backend tiers (STC-210 design, `docs/advisory-lock-backends.md` §1/§9).
 * `process-local` and `file` are host-local; `driver-native` and `lock-server` are
 * cross-host. Tier strength order (strongest first):
 * `lock-server` ≡ `driver-native` > `file` > `process-local`.
 * @typedef {"process-local" | "file" | "driver-native" | "lock-server"} AdvisoryLockTier
 */
/**
 * One per-lock-name backend policy entry as declared in configuration (§5).
 * @typedef {object} AdvisoryLockBackendPolicyEntry
 * @property {string} name - Lock name or `*`-suffixed glob pattern (e.g. `background_jobs:*`).
 * @property {AdvisoryLockTier} [minTier] - Weakest tier this name may ever be served by. Defaults to `driver-native` (default-deny).
 * @property {AdvisoryLockTier[]} [allowedTiers] - Explicit whitelist of servable tiers. Defaults to every tier at or above `minTier`.
 * @property {AdvisoryLockTier} [preferredTier] - Tier used when available; falling below it triggers the fallback report (§3). Defaults to `driver-native`.
 */
/**
 * Policy resolved for one concrete lock name, with tier gaps already closed:
 * `allowedTiers` always contains every tier at or above `minTier`, so a
 * cross-host-minimum name can never be served by `file` or `process-local`.
 * @typedef {object} ResolvedAdvisoryLockBackendPolicy
 * @property {AdvisoryLockTier} minTier - Weakest tier this name may be served by.
 * @property {AdvisoryLockTier[]} allowedTiers - Tiers that may serve this name (minimum-closed).
 * @property {AdvisoryLockTier} preferredTier - Tier preferred when available.
 * @property {AdvisoryLockBackendPolicyEntry | null} entry - The matched configuration entry, or null for the default policy.
 */
/**
 * Thrown when an acquisition would have to be served by a tier below the
 * lock name's declared minimum tier. Fail-closed refusal (§9): the name is
 * never served by the weaker tier, and the refusal is reported on the
 * framework-error channel as `advisory-lock-min-tier-refused`.
 */
export class AdvisoryLockMinTierRefusedError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{lockName: string, requestedBackend: AdvisoryLockTier, minTier: AdvisoryLockTier}} args - Refusal details.
     */
    constructor(message, { lockName, requestedBackend, minTier }) {
        super(message);
        this.name = "AdvisoryLockMinTierRefusedError";
        this.lockName = lockName;
        this.requestedBackend = requestedBackend;
        this.minTier = minTier;
    }
}
/**
 * Thrown when no enabled backend that satisfies the lock name's minimum tier
 * is available (§9). Distinct from `AdvisoryLockTimeoutError` (a backend
 * served the wait but the holder never released).
 */
export class AdvisoryLockBackendUnavailableError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{lockName: string, minTier: AdvisoryLockTier, reasons: string[]}} args - Unavailability details.
     */
    constructor(message, { lockName, minTier, reasons }) {
        super(message);
        this.name = "AdvisoryLockBackendUnavailableError";
        this.lockName = lockName;
        this.minTier = minTier;
        this.reasons = reasons;
    }
}
/**
 * Tier strength ranks (§9): higher rank is stronger. `lock-server` and
 * `driver-native` are both cross-host and rank equal.
 * @type {Record<AdvisoryLockTier, number>} */
const TIER_RANKS = {
    "driver-native": 2,
    file: 1,
    "lock-server": 3,
    "process-local": 0
};
/** All tiers ordered strongest-first. */
const TIERS_STRONGEST_FIRST = /** @type {AdvisoryLockTier[]} */ (["lock-server", "driver-native", "file", "process-local"]);
/**
 * Runs tier rank.
 * @param {AdvisoryLockTier} tier - Tier to rank.
 * @returns {number} - Strength rank (higher is stronger).
 */
export function advisoryLockTierRank(tier) {
    const rank = TIER_RANKS[tier];
    if (rank === undefined)
        throw new Error(`Unknown advisory-lock tier ${JSON.stringify(String(tier))}`);
    return rank;
}
/**
 * Runs tier is at least as strong as.
 * @param {AdvisoryLockTier} tier - Candidate serving tier.
 * @param {AdvisoryLockTier} minimum - Required minimum tier.
 * @returns {boolean} - Whether `tier` satisfies the minimum.
 */
export function advisoryLockTierSatisfies(tier, minimum) {
    return advisoryLockTierRank(tier) >= advisoryLockTierRank(minimum);
}
/**
 * Resolves the effective backend policy for one concrete lock name:
 * longest-prefix glob match over the configured entries (exact names win),
 * default-deny for undeclared names (`minTier: driver-native`,
 * `preferredTier: driver-native`), and `allowedTiers` closed upward so a
 * cross-host minimum can never be served by a host-local tier.
 * @param {string} lockName - Concrete lock name.
 * @param {AdvisoryLockBackendPolicyEntry[] | undefined} policy - Configured policy entries.
 * @returns {ResolvedAdvisoryLockBackendPolicy} - Resolved policy.
 */
export function resolveAdvisoryLockBackendPolicy(lockName, policy) {
    const entry = matchAdvisoryLockPolicyEntry(lockName, policy);
    const minTier = entry?.minTier ?? "driver-native";
    const preferredTier = entry?.preferredTier ?? "driver-native";
    // §9: eligibility filters to tier strength >= minTier even when a weaker
    // tier was declared in `allowedTiers` — a cross-host minimum can never be
    // served by `file` or `process-local`. A `preferredTier` below the minimum
    // stays visible here so the runner can refuse it loudly before contacting
    // the weaker backend.
    const declaredAllowed = entry?.allowedTiers;
    const allowedTiers = TIERS_STRONGEST_FIRST.filter((tier) => {
        if (!advisoryLockTierSatisfies(tier, minTier))
            return false;
        if (!Array.isArray(declaredAllowed))
            return true;
        return declaredAllowed.includes(tier);
    });
    return { allowedTiers, entry: entry ?? null, minTier, preferredTier };
}
/**
 * Matches one policy entry for a lock name: exact `name` matches win;
 * otherwise the longest `*`-suffixed prefix pattern wins.
 * @param {string} lockName - Concrete lock name.
 * @param {AdvisoryLockBackendPolicyEntry[] | undefined} policy - Configured policy entries.
 * @returns {AdvisoryLockBackendPolicyEntry | null} - Matched entry or null.
 */
function matchAdvisoryLockPolicyEntry(lockName, policy) {
    if (!Array.isArray(policy))
        return null;
    let bestPrefixMatch = null;
    let bestPrefixLength = -1;
    for (const entry of policy) {
        if (typeof entry?.name !== "string")
            continue;
        if (entry.name === lockName)
            return entry;
        if (entry.name.endsWith("*")) {
            const prefix = entry.name.slice(0, -1);
            if (lockName.startsWith(prefix) && prefix.length > bestPrefixLength) {
                bestPrefixMatch = entry;
                bestPrefixLength = prefix.length;
            }
        }
    }
    return bestPrefixMatch;
}
/**
 * Refuses a downgrade below the lock name's minimum tier before any contact
 * with the weaker backend (§9), reporting the refusal on the framework-error
 * channel so a silent downgrade is impossible to hide.
 * @param {object} args - Refusal args.
 * @param {import("../configuration.js").default} args.configuration - Configuration owning the error channel.
 * @param {string} args.lockName - Lock name.
 * @param {AdvisoryLockTier} args.requestedBackend - Tier the acquisition would fall to.
 * @param {AdvisoryLockTier} args.minTier - Declared minimum tier.
 * @returns {never} - Always throws.
 */
export function refuseAdvisoryLockTierBelowMinimum({ configuration, lockName, requestedBackend, minTier }) {
    const error = new AdvisoryLockMinTierRefusedError(`Advisory lock ${JSON.stringify(lockName)} requires minimum tier ${JSON.stringify(minTier)}; the ${JSON.stringify(requestedBackend)} tier is refused. Enable a cross-host backend or declare minTier: "file" for this lock name (single-host deployments only).`, { lockName, minTier, requestedBackend });
    configuration.getErrorEvents().emit("framework-error", {
        context: "advisory-lock-min-tier-refused",
        error,
        lockName,
        minTier,
        requestedBackend
    });
    configuration.getErrorEvents().emit("all-error", {
        context: "advisory-lock-min-tier-refused",
        error,
        errorType: "framework-error",
        lockName,
        minTier,
        requestedBackend
    });
    throw error;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWJhY2tlbmQtcG9saWN5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7O0dBTUc7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBRUg7Ozs7O0dBS0c7QUFDSCxNQUFNLE9BQU8sK0JBQWdDLFNBQVEsS0FBSztJQUN4RDs7OztPQUlHO0lBQ0gsWUFBWSxPQUFPLEVBQUUsRUFBQyxRQUFRLEVBQUUsZ0JBQWdCLEVBQUUsT0FBTyxFQUFDO1FBQ3hELEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNkLElBQUksQ0FBQyxJQUFJLEdBQUcsaUNBQWlDLENBQUE7UUFDN0MsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7UUFDeEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO0lBQ3hCLENBQUM7Q0FDRjtBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLE9BQU8sbUNBQW9DLFNBQVEsS0FBSztJQUM1RDs7OztPQUlHO0lBQ0gsWUFBWSxPQUFPLEVBQUUsRUFBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBQztRQUMvQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLHFDQUFxQyxDQUFBO1FBQ2pELElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO0lBQ3hCLENBQUM7Q0FDRjtBQUVEOzs7OENBRzhDO0FBQzlDLE1BQU0sVUFBVSxHQUFHO0lBQ2pCLGVBQWUsRUFBRSxDQUFDO0lBQ2xC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LEdBQUcsS0FBSyxDQUFBO2dCQUN2QixnQkFBZ0IsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFBO1lBQ2xDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sZUFBZSxDQUFBO0FBQ3hCLENBQUM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBTSxVQUFVLGtDQUFrQyxDQUFDLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxnQkFBZ0IsRUFBRSxPQUFPLEVBQUM7SUFDckcsTUFBTSxLQUFLLEdBQUcsSUFBSSwrQkFBK0IsQ0FDL0MsaUJBQWlCLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLDBCQUEwQixJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxTQUFTLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsNkhBQTZILEVBQ2hRLEVBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBQyxDQUN0QyxDQUFBO0lBRUQsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRTtRQUNyRCxPQUFPLEVBQUUsZ0NBQWdDO1FBQ3pDLEtBQUs7UUFDTCxRQUFRO1FBQ1IsT0FBTztRQUNQLGdCQUFnQjtLQUNqQixDQUFDLENBQUE7SUFDRixhQUFhLENBQUMsY0FBYyxFQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRTtRQUMvQyxPQUFPLEVBQUUsZ0NBQWdDO1FBQ3pDLEtBQUs7UUFDTCxTQUFTLEVBQUUsaUJBQWlCO1FBQzVCLFFBQVE7UUFDUixPQUFPO1FBQ1AsZ0JBQWdCO0tBQ2pCLENBQUMsQ0FBQTtJQUVGLE1BQU0sS0FBSyxDQUFBO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEFkdmlzb3J5LWxvY2sgYmFja2VuZCB0aWVycyAoU1RDLTIxMCBkZXNpZ24sIGBkb2NzL2Fkdmlzb3J5LWxvY2stYmFja2VuZHMubWRgIMKnMS/CpzkpLlxuICogYHByb2Nlc3MtbG9jYWxgIGFuZCBgZmlsZWAgYXJlIGhvc3QtbG9jYWw7IGBkcml2ZXItbmF0aXZlYCBhbmQgYGxvY2stc2VydmVyYCBhcmVcbiAqIGNyb3NzLWhvc3QuIFRpZXIgc3RyZW5ndGggb3JkZXIgKHN0cm9uZ2VzdCBmaXJzdCk6XG4gKiBgbG9jay1zZXJ2ZXJgIOKJoSBgZHJpdmVyLW5hdGl2ZWAgPiBgZmlsZWAgPiBgcHJvY2Vzcy1sb2NhbGAuXG4gKiBAdHlwZWRlZiB7XCJwcm9jZXNzLWxvY2FsXCIgfCBcImZpbGVcIiB8IFwiZHJpdmVyLW5hdGl2ZVwiIHwgXCJsb2NrLXNlcnZlclwifSBBZHZpc29yeUxvY2tUaWVyXG4gKi9cbi8qKlxuICogT25lIHBlci1sb2NrLW5hbWUgYmFja2VuZCBwb2xpY3kgZW50cnkgYXMgZGVjbGFyZWQgaW4gY29uZmlndXJhdGlvbiAowqc1KS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUgb3IgYCpgLXN1ZmZpeGVkIGdsb2IgcGF0dGVybiAoZS5nLiBgYmFja2dyb3VuZF9qb2JzOipgKS5cbiAqIEBwcm9wZXJ0eSB7QWR2aXNvcnlMb2NrVGllcn0gW21pblRpZXJdIC0gV2Vha2VzdCB0aWVyIHRoaXMgbmFtZSBtYXkgZXZlciBiZSBzZXJ2ZWQgYnkuIERlZmF1bHRzIHRvIGBkcml2ZXItbmF0aXZlYCAoZGVmYXVsdC1kZW55KS5cbiAqIEBwcm9wZXJ0eSB7QWR2aXNvcnlMb2NrVGllcltdfSBbYWxsb3dlZFRpZXJzXSAtIEV4cGxpY2l0IHdoaXRlbGlzdCBvZiBzZXJ2YWJsZSB0aWVycy4gRGVmYXVsdHMgdG8gZXZlcnkgdGllciBhdCBvciBhYm92ZSBgbWluVGllcmAuXG4gKiBAcHJvcGVydHkge0Fkdmlzb3J5TG9ja1RpZXJ9IFtwcmVmZXJyZWRUaWVyXSAtIFRpZXIgdXNlZCB3aGVuIGF2YWlsYWJsZTsgZmFsbGluZyBiZWxvdyBpdCB0cmlnZ2VycyB0aGUgZmFsbGJhY2sgcmVwb3J0ICjCpzMpLiBEZWZhdWx0cyB0byBgZHJpdmVyLW5hdGl2ZWAuXG4gKi9cbi8qKlxuICogUG9saWN5IHJlc29sdmVkIGZvciBvbmUgY29uY3JldGUgbG9jayBuYW1lLCB3aXRoIHRpZXIgZ2FwcyBhbHJlYWR5IGNsb3NlZDpcbiAqIGBhbGxvd2VkVGllcnNgIGFsd2F5cyBjb250YWlucyBldmVyeSB0aWVyIGF0IG9yIGFib3ZlIGBtaW5UaWVyYCwgc28gYVxuICogY3Jvc3MtaG9zdC1taW5pbXVtIG5hbWUgY2FuIG5ldmVyIGJlIHNlcnZlZCBieSBgZmlsZWAgb3IgYHByb2Nlc3MtbG9jYWxgLlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb2x2ZWRBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5XG4gKiBAcHJvcGVydHkge0Fkdmlzb3J5TG9ja1RpZXJ9IG1pblRpZXIgLSBXZWFrZXN0IHRpZXIgdGhpcyBuYW1lIG1heSBiZSBzZXJ2ZWQgYnkuXG4gKiBAcHJvcGVydHkge0Fkdmlzb3J5TG9ja1RpZXJbXX0gYWxsb3dlZFRpZXJzIC0gVGllcnMgdGhhdCBtYXkgc2VydmUgdGhpcyBuYW1lIChtaW5pbXVtLWNsb3NlZCkuXG4gKiBAcHJvcGVydHkge0Fkdmlzb3J5TG9ja1RpZXJ9IHByZWZlcnJlZFRpZXIgLSBUaWVyIHByZWZlcnJlZCB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwcm9wZXJ0eSB7QWR2aXNvcnlMb2NrQmFja2VuZFBvbGljeUVudHJ5IHwgbnVsbH0gZW50cnkgLSBUaGUgbWF0Y2hlZCBjb25maWd1cmF0aW9uIGVudHJ5LCBvciBudWxsIGZvciB0aGUgZGVmYXVsdCBwb2xpY3kuXG4gKi9cblxuLyoqXG4gKiBUaHJvd24gd2hlbiBhbiBhY3F1aXNpdGlvbiB3b3VsZCBoYXZlIHRvIGJlIHNlcnZlZCBieSBhIHRpZXIgYmVsb3cgdGhlXG4gKiBsb2NrIG5hbWUncyBkZWNsYXJlZCBtaW5pbXVtIHRpZXIuIEZhaWwtY2xvc2VkIHJlZnVzYWwgKMKnOSk6IHRoZSBuYW1lIGlzXG4gKiBuZXZlciBzZXJ2ZWQgYnkgdGhlIHdlYWtlciB0aWVyLCBhbmQgdGhlIHJlZnVzYWwgaXMgcmVwb3J0ZWQgb24gdGhlXG4gKiBmcmFtZXdvcmstZXJyb3IgY2hhbm5lbCBhcyBgYWR2aXNvcnktbG9jay1taW4tdGllci1yZWZ1c2VkYC5cbiAqL1xuZXhwb3J0IGNsYXNzIEFkdmlzb3J5TG9ja01pblRpZXJSZWZ1c2VkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e2xvY2tOYW1lOiBzdHJpbmcsIHJlcXVlc3RlZEJhY2tlbmQ6IEFkdmlzb3J5TG9ja1RpZXIsIG1pblRpZXI6IEFkdmlzb3J5TG9ja1RpZXJ9fSBhcmdzIC0gUmVmdXNhbCBkZXRhaWxzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge2xvY2tOYW1lLCByZXF1ZXN0ZWRCYWNrZW5kLCBtaW5UaWVyfSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gXCJBZHZpc29yeUxvY2tNaW5UaWVyUmVmdXNlZEVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbG9ja05hbWVcbiAgICB0aGlzLnJlcXVlc3RlZEJhY2tlbmQgPSByZXF1ZXN0ZWRCYWNrZW5kXG4gICAgdGhpcy5taW5UaWVyID0gbWluVGllclxuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gbm8gZW5hYmxlZCBiYWNrZW5kIHRoYXQgc2F0aXNmaWVzIHRoZSBsb2NrIG5hbWUncyBtaW5pbXVtIHRpZXJcbiAqIGlzIGF2YWlsYWJsZSAowqc5KS4gRGlzdGluY3QgZnJvbSBgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yYCAoYSBiYWNrZW5kXG4gKiBzZXJ2ZWQgdGhlIHdhaXQgYnV0IHRoZSBob2xkZXIgbmV2ZXIgcmVsZWFzZWQpLlxuICovXG5leHBvcnQgY2xhc3MgQWR2aXNvcnlMb2NrQmFja2VuZFVuYXZhaWxhYmxlRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e2xvY2tOYW1lOiBzdHJpbmcsIG1pblRpZXI6IEFkdmlzb3J5TG9ja1RpZXIsIHJlYXNvbnM6IHN0cmluZ1tdfX0gYXJncyAtIFVuYXZhaWxhYmlsaXR5IGRldGFpbHMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bG9ja05hbWUsIG1pblRpZXIsIHJlYXNvbnN9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZUVycm9yXCJcbiAgICB0aGlzLmxvY2tOYW1lID0gbG9ja05hbWVcbiAgICB0aGlzLm1pblRpZXIgPSBtaW5UaWVyXG4gICAgdGhpcy5yZWFzb25zID0gcmVhc29uc1xuICB9XG59XG5cbi8qKlxuICogVGllciBzdHJlbmd0aCByYW5rcyAowqc5KTogaGlnaGVyIHJhbmsgaXMgc3Ryb25nZXIuIGBsb2NrLXNlcnZlcmAgYW5kXG4gKiBgZHJpdmVyLW5hdGl2ZWAgYXJlIGJvdGggY3Jvc3MtaG9zdCBhbmQgcmFuayBlcXVhbC5cbiAqIEB0eXBlIHtSZWNvcmQ8QWR2aXNvcnlMb2NrVGllciwgbnVtYmVyPn0gKi9cbmNvbnN0IFRJRVJfUkFOS1MgPSB7XG4gIFwiZHJpdmVyLW5hdGl2ZVwiOiAyLFxuICBmaWxlOiAxLFxuICBcImxvY2stc2VydmVyXCI6IDMsXG4gIFwicHJvY2Vzcy1sb2NhbFwiOiAwXG59XG5cbi8qKiBBbGwgdGllcnMgb3JkZXJlZCBzdHJvbmdlc3QtZmlyc3QuICovXG5jb25zdCBUSUVSU19TVFJPTkdFU1RfRklSU1QgPSAvKiogQHR5cGUge0Fkdmlzb3J5TG9ja1RpZXJbXX0gKi8gKFtcImxvY2stc2VydmVyXCIsIFwiZHJpdmVyLW5hdGl2ZVwiLCBcImZpbGVcIiwgXCJwcm9jZXNzLWxvY2FsXCJdKVxuXG4vKipcbiAqIFJ1bnMgdGllciByYW5rLlxuICogQHBhcmFtIHtBZHZpc29yeUxvY2tUaWVyfSB0aWVyIC0gVGllciB0byByYW5rLlxuICogQHJldHVybnMge251bWJlcn0gLSBTdHJlbmd0aCByYW5rIChoaWdoZXIgaXMgc3Ryb25nZXIpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvcnlMb2NrVGllclJhbmsodGllcikge1xuICBjb25zdCByYW5rID0gVElFUl9SQU5LU1t0aWVyXVxuXG4gIGlmIChyYW5rID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhZHZpc29yeS1sb2NrIHRpZXIgJHtKU09OLnN0cmluZ2lmeShTdHJpbmcodGllcikpfWApXG5cbiAgcmV0dXJuIHJhbmtcbn1cblxuLyoqXG4gKiBSdW5zIHRpZXIgaXMgYXQgbGVhc3QgYXMgc3Ryb25nIGFzLlxuICogQHBhcmFtIHtBZHZpc29yeUxvY2tUaWVyfSB0aWVyIC0gQ2FuZGlkYXRlIHNlcnZpbmcgdGllci5cbiAqIEBwYXJhbSB7QWR2aXNvcnlMb2NrVGllcn0gbWluaW11bSAtIFJlcXVpcmVkIG1pbmltdW0gdGllci5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYHRpZXJgIHNhdGlzZmllcyB0aGUgbWluaW11bS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3J5TG9ja1RpZXJTYXRpc2ZpZXModGllciwgbWluaW11bSkge1xuICByZXR1cm4gYWR2aXNvcnlMb2NrVGllclJhbmsodGllcikgPj0gYWR2aXNvcnlMb2NrVGllclJhbmsobWluaW11bSlcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgZWZmZWN0aXZlIGJhY2tlbmQgcG9saWN5IGZvciBvbmUgY29uY3JldGUgbG9jayBuYW1lOlxuICogbG9uZ2VzdC1wcmVmaXggZ2xvYiBtYXRjaCBvdmVyIHRoZSBjb25maWd1cmVkIGVudHJpZXMgKGV4YWN0IG5hbWVzIHdpbiksXG4gKiBkZWZhdWx0LWRlbnkgZm9yIHVuZGVjbGFyZWQgbmFtZXMgKGBtaW5UaWVyOiBkcml2ZXItbmF0aXZlYCxcbiAqIGBwcmVmZXJyZWRUaWVyOiBkcml2ZXItbmF0aXZlYCksIGFuZCBgYWxsb3dlZFRpZXJzYCBjbG9zZWQgdXB3YXJkIHNvIGFcbiAqIGNyb3NzLWhvc3QgbWluaW11bSBjYW4gbmV2ZXIgYmUgc2VydmVkIGJ5IGEgaG9zdC1sb2NhbCB0aWVyLlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2tOYW1lIC0gQ29uY3JldGUgbG9jayBuYW1lLlxuICogQHBhcmFtIHtBZHZpc29yeUxvY2tCYWNrZW5kUG9saWN5RW50cnlbXSB8IHVuZGVmaW5lZH0gcG9saWN5IC0gQ29uZmlndXJlZCBwb2xpY3kgZW50cmllcy5cbiAqIEByZXR1cm5zIHtSZXNvbHZlZEFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3l9IC0gUmVzb2x2ZWQgcG9saWN5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUFkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3kobG9ja05hbWUsIHBvbGljeSkge1xuICBjb25zdCBlbnRyeSA9IG1hdGNoQWR2aXNvcnlMb2NrUG9saWN5RW50cnkobG9ja05hbWUsIHBvbGljeSlcbiAgY29uc3QgbWluVGllciA9IGVudHJ5Py5taW5UaWVyID8/IFwiZHJpdmVyLW5hdGl2ZVwiXG4gIGNvbnN0IHByZWZlcnJlZFRpZXIgPSBlbnRyeT8ucHJlZmVycmVkVGllciA/PyBcImRyaXZlci1uYXRpdmVcIlxuXG4gIC8vIMKnOTogZWxpZ2liaWxpdHkgZmlsdGVycyB0byB0aWVyIHN0cmVuZ3RoID49IG1pblRpZXIgZXZlbiB3aGVuIGEgd2Vha2VyXG4gIC8vIHRpZXIgd2FzIGRlY2xhcmVkIGluIGBhbGxvd2VkVGllcnNgIOKAlCBhIGNyb3NzLWhvc3QgbWluaW11bSBjYW4gbmV2ZXIgYmVcbiAgLy8gc2VydmVkIGJ5IGBmaWxlYCBvciBgcHJvY2Vzcy1sb2NhbGAuIEEgYHByZWZlcnJlZFRpZXJgIGJlbG93IHRoZSBtaW5pbXVtXG4gIC8vIHN0YXlzIHZpc2libGUgaGVyZSBzbyB0aGUgcnVubmVyIGNhbiByZWZ1c2UgaXQgbG91ZGx5IGJlZm9yZSBjb250YWN0aW5nXG4gIC8vIHRoZSB3ZWFrZXIgYmFja2VuZC5cbiAgY29uc3QgZGVjbGFyZWRBbGxvd2VkID0gZW50cnk/LmFsbG93ZWRUaWVyc1xuICBjb25zdCBhbGxvd2VkVGllcnMgPSBUSUVSU19TVFJPTkdFU1RfRklSU1QuZmlsdGVyKCh0aWVyKSA9PiB7XG4gICAgaWYgKCFhZHZpc29yeUxvY2tUaWVyU2F0aXNmaWVzKHRpZXIsIG1pblRpZXIpKSByZXR1cm4gZmFsc2VcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShkZWNsYXJlZEFsbG93ZWQpKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGRlY2xhcmVkQWxsb3dlZC5pbmNsdWRlcyh0aWVyKVxuICB9KVxuXG4gIHJldHVybiB7YWxsb3dlZFRpZXJzLCBlbnRyeTogZW50cnkgPz8gbnVsbCwgbWluVGllciwgcHJlZmVycmVkVGllcn1cbn1cblxuLyoqXG4gKiBNYXRjaGVzIG9uZSBwb2xpY3kgZW50cnkgZm9yIGEgbG9jayBuYW1lOiBleGFjdCBgbmFtZWAgbWF0Y2hlcyB3aW47XG4gKiBvdGhlcndpc2UgdGhlIGxvbmdlc3QgYCpgLXN1ZmZpeGVkIHByZWZpeCBwYXR0ZXJuIHdpbnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9ja05hbWUgLSBDb25jcmV0ZSBsb2NrIG5hbWUuXG4gKiBAcGFyYW0ge0Fkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeVtdIHwgdW5kZWZpbmVkfSBwb2xpY3kgLSBDb25maWd1cmVkIHBvbGljeSBlbnRyaWVzLlxuICogQHJldHVybnMge0Fkdmlzb3J5TG9ja0JhY2tlbmRQb2xpY3lFbnRyeSB8IG51bGx9IC0gTWF0Y2hlZCBlbnRyeSBvciBudWxsLlxuICovXG5mdW5jdGlvbiBtYXRjaEFkdmlzb3J5TG9ja1BvbGljeUVudHJ5KGxvY2tOYW1lLCBwb2xpY3kpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHBvbGljeSkpIHJldHVybiBudWxsXG5cbiAgbGV0IGJlc3RQcmVmaXhNYXRjaCA9IG51bGxcbiAgbGV0IGJlc3RQcmVmaXhMZW5ndGggPSAtMVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgcG9saWN5KSB7XG4gICAgaWYgKHR5cGVvZiBlbnRyeT8ubmFtZSAhPT0gXCJzdHJpbmdcIikgY29udGludWVcblxuICAgIGlmIChlbnRyeS5uYW1lID09PSBsb2NrTmFtZSkgcmV0dXJuIGVudHJ5XG5cbiAgICBpZiAoZW50cnkubmFtZS5lbmRzV2l0aChcIipcIikpIHtcbiAgICAgIGNvbnN0IHByZWZpeCA9IGVudHJ5Lm5hbWUuc2xpY2UoMCwgLTEpXG5cbiAgICAgIGlmIChsb2NrTmFtZS5zdGFydHNXaXRoKHByZWZpeCkgJiYgcHJlZml4Lmxlbmd0aCA+IGJlc3RQcmVmaXhMZW5ndGgpIHtcbiAgICAgICAgYmVzdFByZWZpeE1hdGNoID0gZW50cnlcbiAgICAgICAgYmVzdFByZWZpeExlbmd0aCA9IHByZWZpeC5sZW5ndGhcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmVzdFByZWZpeE1hdGNoXG59XG5cbi8qKlxuICogUmVmdXNlcyBhIGRvd25ncmFkZSBiZWxvdyB0aGUgbG9jayBuYW1lJ3MgbWluaW11bSB0aWVyIGJlZm9yZSBhbnkgY29udGFjdFxuICogd2l0aCB0aGUgd2Vha2VyIGJhY2tlbmQgKMKnOSksIHJlcG9ydGluZyB0aGUgcmVmdXNhbCBvbiB0aGUgZnJhbWV3b3JrLWVycm9yXG4gKiBjaGFubmVsIHNvIGEgc2lsZW50IGRvd25ncmFkZSBpcyBpbXBvc3NpYmxlIHRvIGhpZGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlZnVzYWwgYXJncy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgZXJyb3IgY2hhbm5lbC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxvY2tOYW1lIC0gTG9jayBuYW1lLlxuICogQHBhcmFtIHtBZHZpc29yeUxvY2tUaWVyfSBhcmdzLnJlcXVlc3RlZEJhY2tlbmQgLSBUaWVyIHRoZSBhY3F1aXNpdGlvbiB3b3VsZCBmYWxsIHRvLlxuICogQHBhcmFtIHtBZHZpc29yeUxvY2tUaWVyfSBhcmdzLm1pblRpZXIgLSBEZWNsYXJlZCBtaW5pbXVtIHRpZXIuXG4gKiBAcmV0dXJucyB7bmV2ZXJ9IC0gQWx3YXlzIHRocm93cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZnVzZUFkdmlzb3J5TG9ja1RpZXJCZWxvd01pbmltdW0oe2NvbmZpZ3VyYXRpb24sIGxvY2tOYW1lLCByZXF1ZXN0ZWRCYWNrZW5kLCBtaW5UaWVyfSkge1xuICBjb25zdCBlcnJvciA9IG5ldyBBZHZpc29yeUxvY2tNaW5UaWVyUmVmdXNlZEVycm9yKFxuICAgIGBBZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobG9ja05hbWUpfSByZXF1aXJlcyBtaW5pbXVtIHRpZXIgJHtKU09OLnN0cmluZ2lmeShtaW5UaWVyKX07IHRoZSAke0pTT04uc3RyaW5naWZ5KHJlcXVlc3RlZEJhY2tlbmQpfSB0aWVyIGlzIHJlZnVzZWQuIEVuYWJsZSBhIGNyb3NzLWhvc3QgYmFja2VuZCBvciBkZWNsYXJlIG1pblRpZXI6IFwiZmlsZVwiIGZvciB0aGlzIGxvY2sgbmFtZSAoc2luZ2xlLWhvc3QgZGVwbG95bWVudHMgb25seSkuYCxcbiAgICB7bG9ja05hbWUsIG1pblRpZXIsIHJlcXVlc3RlZEJhY2tlbmR9XG4gIClcblxuICBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCB7XG4gICAgY29udGV4dDogXCJhZHZpc29yeS1sb2NrLW1pbi10aWVyLXJlZnVzZWRcIixcbiAgICBlcnJvcixcbiAgICBsb2NrTmFtZSxcbiAgICBtaW5UaWVyLFxuICAgIHJlcXVlc3RlZEJhY2tlbmRcbiAgfSlcbiAgY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJhbGwtZXJyb3JcIiwge1xuICAgIGNvbnRleHQ6IFwiYWR2aXNvcnktbG9jay1taW4tdGllci1yZWZ1c2VkXCIsXG4gICAgZXJyb3IsXG4gICAgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwiLFxuICAgIGxvY2tOYW1lLFxuICAgIG1pblRpZXIsXG4gICAgcmVxdWVzdGVkQmFja2VuZFxuICB9KVxuXG4gIHRocm93IGVycm9yXG59XG4iXX0=