export type AdvisoryLockTelemetryReport = {
    /**
     * - Which event fired.
     */
    event: "advisory-lock-slow-acquire" | "advisory-lock-acquire-timeout" | "advisory-lock-slow-hold";
    /**
     * - The contended advisory-lock name.
     */
    lockName: string;
    /**
     * - Tier that served (or refused) the acquisition: `driver-native`, `process-local`, or `file`.
     */
    backendTier: string;
    /**
     * - Measured duration of the acquire wait (or the hold).
     */
    durationMs: number;
    /**
     * - For acquire events: whether the wait eventually acquired the lock. Null for hold reports.
     */
    outcome: "acquired" | "timeout" | null;
    /**
     * - The effective acquire bound for acquire events. Null for hold reports or an unbounded wait.
     */
    timeoutMs: number | null;
    /**
     * - Process-local holder attribution when the tier can name its local holder.
     */
    holderId: string | null;
    /**
     * - Driver-native holder attribution captured at the event moment (MariaDB `IS_USED_LOCK` connection id, PostgreSQL pid, SQL Server session id, SQLite file `pid@hostname`).
     */
    holderConnectionId: string | null;
    /**
     * - Set when the best-effort holder lookup itself failed; the lookup never affects the acquisition.
     */
    holderLookupError: string | null;
};
export type AdvisoryLockTelemetryThresholds = {
    /**
     * - Report an acquire wait slower than this; `null` disables slow-acquire reports.
     */
    slowAcquireMs: number | null;
    /**
     * - Report a hold longer than this at release; `null` disables hold reports.
     */
    slowHoldMs: number | null;
};
/**
 * Event-driven advisory-lock duration telemetry (STC-261, parent epic STC-209).
 *
 * A lock convoy is only fixable when it is *attributable*: which lock name was
 * contended, on which backend tier, for how long, and who held it. These reports
 * fire on the acquisition/release events themselves — never from a periodic
 * scanner — so a contended lock in production surfaces on the telemetry channel
 * with the holder identity available on that tier at that moment, without SSH
 * forensics.
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
 * Reports are emitted on `configuration.getTelemetryEvents()` as `telemetry`
 * with `{context: "advisory-lock-telemetry", event, lockName, backendTier, ...}`
 * payloads.
 *
 * These are measurements, not failures, so they are deliberately kept off the
 * framework-error channel: a bug reporter subscribed to `framework-error` /
 * `all-error` must be able to assume every payload carries a thrown value, and a
 * contention report delivered there became one bug report (plus its symbolication
 * and notification work) per event.
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
export declare const DEFAULT_ADVISORY_LOCK_SLOW_ACQUIRE_MS = 5000;
/** Framework default: report a hold that outlives this at release. */
export declare const DEFAULT_ADVISORY_LOCK_SLOW_HOLD_MS: number;
/**
 * Resolve the telemetry thresholds for one database configuration.
 * An explicit per-database `advisoryLockTelemetry` value wins; `null` opts out
 * of that report; only when neither is configured does the framework default
 * apply.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} args - Database configuration args.
 * @returns {AdvisoryLockTelemetryThresholds} - Resolved thresholds.
 */
export declare function advisoryLockTelemetryThresholds(args: import("../configuration-types.js").DatabaseConfigurationType): AdvisoryLockTelemetryThresholds;
/**
 * Emit one telemetry report on the framework-telemetry channel.
 *
 * When no `telemetry` listener is attached, a one-line summary goes to `stderr`
 * so a convoy is never completely silent. A listener failure can never break
 * lock handling, so emissions are guarded.
 * @param {import("../configuration.js").default} configuration - Configuration instance owning the telemetry channel.
 * @param {AdvisoryLockTelemetryReport} report - The report payload.
 * @returns {void} - No return value.
 */
export declare function emitAdvisoryLockTelemetryReport(configuration: import("../configuration.js").default, report: AdvisoryLockTelemetryReport): void;
/**
 * Reports one acquisition served below the lock name's preferred tier
 * (design §3): the caller wanted the lock server and got the database, so the
 * downgrade must be visible without being mistaken for a failure. Fallbacks are
 * measurements, not errors, so they stay off `framework-error` and its bug
 * reporters (same contract as the duration telemetry).
 * @param {import("../configuration.js").default} configuration - Owning configuration.
 * @param {{lockName: string, preferredTier: string, reason: string, servedBy: string}} report - Fallback details.
 * @returns {void}
 */
export declare function emitAdvisoryLockFallbackReport(configuration: import("../configuration.js").default, report: {
    lockName: string;
    preferredTier: string;
    reason: string;
    servedBy: string;
}): void;
//# sourceMappingURL=advisory-lock-telemetry.d.ts.map