// @ts-check

import {AdvisoryLockBackendUnavailableError} from "./advisory-lock-backend-policy.js"

/**
 * Thrown when a lock-server acquisition could not be attempted because the
 * lock server is unreachable. Distinct from `AdvisoryLockTimeoutError` ("the
 * server was reachable, the holder never released") so a caller can react to
 * an infrastructure outage without guessing.
 */
export class AdvisoryLockServiceUnavailableError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{lockName: string, reason: string}} args - Lock name and failure reason.
   */
  constructor(message, {lockName, reason}) {
    super(message)
    this.name = "AdvisoryLockServiceUnavailableError"
    this.lockName = lockName
    this.reason = reason
  }
}

/**
 * Thrown after a critical section ran on the lock-server tier while its lease
 * was fenced or lost (design §7/§8): the section may have overlapped another
 * holder, so its result must not be trusted as exclusive.
 */
export class AdvisoryLockLostError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{cause?: Error, currentEpoch: number | null, epoch: number | null, lockName: string}} args - Fencing details.
   */
  constructor(message, {cause, currentEpoch, epoch, lockName}) {
    super(message)
    this.name = "AdvisoryLockLostError"
    this.lockName = lockName
    this.epoch = epoch
    this.currentEpoch = currentEpoch
    this.cause = cause
  }
}

/**
 * Builds the error thrown when a lock name's minimum tier cannot be served and
 * no eligible tier is available (design §9, fail-closed).
 * @param {{lockName: string, minTier: import("./advisory-lock-backend-policy.js").AdvisoryLockTier, reasons: string[]}} args - Unavailability details.
 * @returns {AdvisoryLockBackendUnavailableError} - Error to throw.
 */
export function advisoryLockBackendUnavailable(args) {
  const {lockName, minTier, reasons} = args

  return new AdvisoryLockBackendUnavailableError(
    `No eligible advisory-lock backend is available for ${JSON.stringify(lockName)} (minimum tier ${JSON.stringify(minTier)}): ${reasons.join("; ")}`,
    {lockName, minTier, reasons}
  )
}
