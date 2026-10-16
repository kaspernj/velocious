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
  constructor(message, {lockName, requestedBackend, minTier}) {
    super(message)
    this.name = "AdvisoryLockMinTierRefusedError"
    this.lockName = lockName
    this.requestedBackend = requestedBackend
    this.minTier = minTier
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
  constructor(message, {lockName, minTier, reasons}) {
    super(message)
    this.name = "AdvisoryLockBackendUnavailableError"
    this.lockName = lockName
    this.minTier = minTier
    this.reasons = reasons
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
}

/** All tiers ordered strongest-first. */
const TIERS_STRONGEST_FIRST = /** @type {AdvisoryLockTier[]} */ (["lock-server", "driver-native", "file", "process-local"])

/**
 * Runs tier rank.
 * @param {AdvisoryLockTier} tier - Tier to rank.
 * @returns {number} - Strength rank (higher is stronger).
 */
export function advisoryLockTierRank(tier) {
  const rank = TIER_RANKS[tier]

  if (rank === undefined) throw new Error(`Unknown advisory-lock tier ${JSON.stringify(String(tier))}`)

  return rank
}

/**
 * Runs tier is at least as strong as.
 * @param {AdvisoryLockTier} tier - Candidate serving tier.
 * @param {AdvisoryLockTier} minimum - Required minimum tier.
 * @returns {boolean} - Whether `tier` satisfies the minimum.
 */
export function advisoryLockTierSatisfies(tier, minimum) {
  return advisoryLockTierRank(tier) >= advisoryLockTierRank(minimum)
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
  const entry = matchAdvisoryLockPolicyEntry(lockName, policy)
  const minTier = entry?.minTier ?? "driver-native"
  const preferredTier = entry?.preferredTier ?? "driver-native"

  // §9: eligibility filters to tier strength >= minTier even when a weaker
  // tier was declared in `allowedTiers` — a cross-host minimum can never be
  // served by `file` or `process-local`. A `preferredTier` below the minimum
  // stays visible here so the runner can refuse it loudly before contacting
  // the weaker backend.
  const declaredAllowed = entry?.allowedTiers
  const allowedTiers = TIERS_STRONGEST_FIRST.filter((tier) => {
    if (!advisoryLockTierSatisfies(tier, minTier)) return false

    if (!Array.isArray(declaredAllowed)) return true

    return declaredAllowed.includes(tier)
  })

  return {allowedTiers, entry: entry ?? null, minTier, preferredTier}
}

/**
 * Matches one policy entry for a lock name: exact `name` matches win;
 * otherwise the longest `*`-suffixed prefix pattern wins.
 * @param {string} lockName - Concrete lock name.
 * @param {AdvisoryLockBackendPolicyEntry[] | undefined} policy - Configured policy entries.
 * @returns {AdvisoryLockBackendPolicyEntry | null} - Matched entry or null.
 */
function matchAdvisoryLockPolicyEntry(lockName, policy) {
  if (!Array.isArray(policy)) return null

  let bestPrefixMatch = null
  let bestPrefixLength = -1

  for (const entry of policy) {
    if (typeof entry?.name !== "string") continue

    if (entry.name === lockName) return entry

    if (entry.name.endsWith("*")) {
      const prefix = entry.name.slice(0, -1)

      if (lockName.startsWith(prefix) && prefix.length > bestPrefixLength) {
        bestPrefixMatch = entry
        bestPrefixLength = prefix.length
      }
    }
  }

  return bestPrefixMatch
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
export function refuseAdvisoryLockTierBelowMinimum({configuration, lockName, requestedBackend, minTier}) {
  const error = new AdvisoryLockMinTierRefusedError(
    `Advisory lock ${JSON.stringify(lockName)} requires minimum tier ${JSON.stringify(minTier)}; the ${JSON.stringify(requestedBackend)} tier is refused. Enable a cross-host backend or declare minTier: "file" for this lock name (single-host deployments only).`,
    {lockName, minTier, requestedBackend}
  )

  configuration.getErrorEvents().emit("framework-error", {
    context: "advisory-lock-min-tier-refused",
    error,
    lockName,
    minTier,
    requestedBackend
  })
  configuration.getErrorEvents().emit("all-error", {
    context: "advisory-lock-min-tier-refused",
    error,
    errorType: "framework-error",
    lockName,
    minTier,
    requestedBackend
  })

  throw error
}
