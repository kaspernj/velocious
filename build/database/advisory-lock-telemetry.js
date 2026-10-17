// @ts-check

/**
 * Event-driven advisory-lock duration telemetry (STC-261, parent epic STC-209).
 *
 * A lock convoy is only fixable when it is *attributable*: which lock name was
 * contended, on which backend tier, for how long, and who held it. These reports
 * fire on the acquisition/release events themselves — never from a periodic
 * scanner — so a contended lock in production surfaces on the framework-error
 * channel with the holder identity available on that tier at that moment,
 * without SSH forensics.
 *
 * Three events, each with its own threshold (all configurable per database via
 * `advisoryLockTelemetry`, see `docs/advisory-locks.md`):
 *
 * - `advisory-lock-slow-acquire` — an acquire wait completed slower than
 *   `slowAcquireMs` (default 5000), including the eventual outcome (`acquired`
 *   or `timeout`).
 * - `advisory-lock-acquire-timeout` — a wait exceeded its timeout. The report
 *   carries the holder identity available on the tier at that moment: the
 *   driver-native tiers attribute the holder connection (MariaDB
 *   `IS_USED_LOCK`, PostgreSQL `pg_locks` joined to `pg_stat_activity`, SQL
 *   Server `sys.dm_tran_locks` request session, SQLite Node file tier
 *   `owner.json` pid/hostname); the process-local tier reports the owning
 *   driver's `holderId`.
 * - `advisory-lock-slow-hold` — a hold lasted longer than `slowHoldMs`
 *   (default 60000), emitted at release.
 *
 * Reports are emitted on `configuration.getErrorEvents()` as `framework-error`
 * (plus the matching `all-error`) with `{context: "advisory-lock-telemetry",
 * event, lockName, backendTier, ...}` payloads, matching the repo's "never
 * swallow" rule so process-level bug reporters capture them.
 *
 * Holder lookups are strictly best-effort *after* the acquisition already
 * settled: a failed lookup never changes the acquisition outcome and never
 * throws to the caller.
 */

/**
 * One advisory-lock telemetry report.
 * @typedef {object} AdvisoryLockTelemetryReport
 * @property {"advisory-lock-slow-acquire" | "advisory-lock-acquire-timeout" | "advisory-lock-slow-hold"} event - Which event fired.
 * @property {string} lockName - The contended advisory-lock name.
 * @property {string} backendTier - Tier that served (or refused) the acquisition: `driver-native`, `process-local`, or `file`.
 * @property {number} durationMs - Measured duration of the acquire wait (or the hold).
 * @property {"acquired" | "timeout" | null} outcome - For acquire events: whether the wait eventually acquired the lock. Null for hold reports.
 * @property {number | null} timeoutMs - The effective acquire bound for acquire events. Null for hold reports or an unbounded wait.
 * @property {string | null} holderId - Process-local holder attribution when the tier can name its local holder.
 * @property {string | null} holderConnectionId - Driver-native holder attribution captured at the event moment (MariaDB `IS_USED_LOCK` connection id, PostgreSQL pid, SQL Server session id, SQLite file `pid@hostname`).
 * @property {string | null} holderLookupError - Set when the best-effort holder lookup itself failed; the lookup never affects the acquisition.
 */

/**
 * Resolved per-database telemetry thresholds.
 * @typedef {object} AdvisoryLockTelemetryThresholds
 * @property {number | null} slowAcquireMs - Report an acquire wait slower than this; `null` disables slow-acquire reports.
 * @property {number | null} slowHoldMs - Report a hold longer than this at release; `null` disables hold reports.
 */

/** Framework default: report an acquire wait that completed slower than this. */
export const DEFAULT_ADVISORY_LOCK_SLOW_ACQUIRE_MS = 5000

/** Framework default: report a hold that outlives this at release. */
export const DEFAULT_ADVISORY_LOCK_SLOW_HOLD_MS = 60 * 1000

/**
 * Resolve the telemetry thresholds for one database configuration.
 * An explicit per-database `advisoryLockTelemetry` value wins; `null` opts out
 * of that report; only when neither is configured does the framework default
 * apply.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} args - Database configuration args.
 * @returns {AdvisoryLockTelemetryThresholds} - Resolved thresholds.
 */
export function advisoryLockTelemetryThresholds(args) {
  const configured = args?.advisoryLockTelemetry
  /** @type {AdvisoryLockTelemetryThresholds} */
  const thresholds = {
    slowAcquireMs: DEFAULT_ADVISORY_LOCK_SLOW_ACQUIRE_MS,
    slowHoldMs: DEFAULT_ADVISORY_LOCK_SLOW_HOLD_MS
  }

  if (configured?.slowAcquireMs === null) thresholds.slowAcquireMs = null
  else if (typeof configured?.slowAcquireMs === "number" && configured.slowAcquireMs >= 0) thresholds.slowAcquireMs = configured.slowAcquireMs

  if (configured?.slowHoldMs === null) thresholds.slowHoldMs = null
  else if (typeof configured?.slowHoldMs === "number" && configured.slowHoldMs >= 0) thresholds.slowHoldMs = configured.slowHoldMs

  return thresholds
}

/**
 * Emit one telemetry report on the framework-error channel.
 *
 * Mirrors the repo's framework-error emission shape (see `configuration.js`
 * `_reportBeaconError`): when no listener is attached to `framework-error` or
 * `all-error`, a one-line summary goes to `stderr` so a convoy is never
 * completely silent. A listener failure can never break lock handling, so
 * emissions are guarded.
 * @param {import("../configuration.js").default} configuration - Configuration instance owning the error channel.
 * @param {AdvisoryLockTelemetryReport} report - The report payload.
 * @returns {void} - No return value.
 */
export function emitAdvisoryLockTelemetryReport(configuration, report) {
  /** @type {import("eventemitter3").EventEmitter | undefined} */
  let errorEvents

  try {
    errorEvents = configuration?.getErrorEvents()
  } catch {
    return // No configuration to report through — never break lock handling.
  }

  if (!errorEvents) return

  const hasListener = errorEvents.listenerCount("framework-error") > 0
    || errorEvents.listenerCount("all-error") > 0
  const payload = {context: "advisory-lock-telemetry", ...report}

  try {
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  } catch {
    // A broken listener must never surface as a lock failure.
  }

  if (!hasListener) {
    console.error(`[velocious advisory-lock-telemetry ${report.event}] lock=${JSON.stringify(report.lockName)} tier=${report.backendTier} durationMs=${report.durationMs}${report.outcome ? ` outcome=${report.outcome}` : ""}${report.holderConnectionId ? ` holderConnectionId=${report.holderConnectionId}` : ""}${report.holderId ? ` holderId=${report.holderId}` : ""} — subscribe via configuration.getErrorEvents().on("framework-error", …) to route these reports to your bug reporter`)
  }
}
