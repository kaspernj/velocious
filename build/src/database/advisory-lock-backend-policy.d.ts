export type AdvisoryLockTier = "process-local" | "file" | "driver-native" | "lock-server";
export type AdvisoryLockBackendPolicyEntry = {
    /**
     * - Lock name or `*`-suffixed glob pattern (e.g. `background_jobs:*`).
     */
    name: string;
    /**
     * - Weakest tier this name may ever be served by. Defaults to `driver-native` (default-deny).
     */
    minTier?: AdvisoryLockTier;
    /**
     * - Explicit whitelist of servable tiers. Defaults to every tier at or above `minTier`.
     */
    allowedTiers?: AdvisoryLockTier[];
    /**
     * - Tier used when available; falling below it triggers the fallback report (§3). Defaults to `driver-native`.
     */
    preferredTier?: AdvisoryLockTier;
};
export type ResolvedAdvisoryLockBackendPolicy = {
    /**
     * - Weakest tier this name may be served by.
     */
    minTier: AdvisoryLockTier;
    /**
     * - Tiers that may serve this name (minimum-closed).
     */
    allowedTiers: AdvisoryLockTier[];
    /**
     * - Tier preferred when available.
     */
    preferredTier: AdvisoryLockTier;
    /**
     * - The matched configuration entry, or null for the default policy.
     */
    entry: AdvisoryLockBackendPolicyEntry | null;
};
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
export declare class AdvisoryLockMinTierRefusedError extends Error {
    lockName: string;
    requestedBackend: AdvisoryLockTier;
    minTier: AdvisoryLockTier;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{lockName: string, requestedBackend: AdvisoryLockTier, minTier: AdvisoryLockTier}} args - Refusal details.
     */
    constructor(message: string, { lockName, requestedBackend, minTier }: {
        lockName: string;
        requestedBackend: AdvisoryLockTier;
        minTier: AdvisoryLockTier;
    });
}
/**
 * Thrown when no enabled backend that satisfies the lock name's minimum tier
 * is available (§9). Distinct from `AdvisoryLockTimeoutError` (a backend
 * served the wait but the holder never released).
 */
export declare class AdvisoryLockBackendUnavailableError extends Error {
    lockName: string;
    minTier: AdvisoryLockTier;
    reasons: string[];
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{lockName: string, minTier: AdvisoryLockTier, reasons: string[]}} args - Unavailability details.
     */
    constructor(message: string, { lockName, minTier, reasons }: {
        lockName: string;
        minTier: AdvisoryLockTier;
        reasons: string[];
    });
}
/**
 * Runs tier rank.
 * @param {AdvisoryLockTier} tier - Tier to rank.
 * @returns {number} - Strength rank (higher is stronger).
 */
export declare function advisoryLockTierRank(tier: AdvisoryLockTier): number;
/**
 * Runs tier is at least as strong as.
 * @param {AdvisoryLockTier} tier - Candidate serving tier.
 * @param {AdvisoryLockTier} minimum - Required minimum tier.
 * @returns {boolean} - Whether `tier` satisfies the minimum.
 */
export declare function advisoryLockTierSatisfies(tier: AdvisoryLockTier, minimum: AdvisoryLockTier): boolean;
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
export declare function resolveAdvisoryLockBackendPolicy(lockName: string, policy: AdvisoryLockBackendPolicyEntry[] | undefined): ResolvedAdvisoryLockBackendPolicy;
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
export declare function refuseAdvisoryLockTierBelowMinimum({ configuration, lockName, requestedBackend, minTier }: {
    configuration: import("../configuration.js").default;
    lockName: string;
    requestedBackend: AdvisoryLockTier;
    minTier: AdvisoryLockTier;
}): never;
//# sourceMappingURL=advisory-lock-backend-policy.d.ts.map