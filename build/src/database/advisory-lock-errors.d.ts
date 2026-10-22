import { AdvisoryLockBackendUnavailableError } from "./advisory-lock-backend-policy.js";
/**
 * Thrown when a lock-server acquisition could not be attempted because the
 * lock server is unreachable. Distinct from `AdvisoryLockTimeoutError` ("the
 * server was reachable, the holder never released") so a caller can react to
 * an infrastructure outage without guessing.
 */
export declare class AdvisoryLockServiceUnavailableError extends Error {
    lockName: string;
    reason: string;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{lockName: string, reason: string}} args - Lock name and failure reason.
     */
    constructor(message: string, { lockName, reason }: {
        lockName: string;
        reason: string;
    });
}
/**
 * Thrown after a critical section ran on the lock-server tier while its lease
 * was fenced or lost (design §7/§8): the section may have overlapped another
 * holder, so its result must not be trusted as exclusive.
 */
export declare class AdvisoryLockLostError extends Error {
    lockName: string;
    epoch: number | null;
    currentEpoch: number | null;
    cause: Error | undefined;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{cause?: Error, currentEpoch: number | null, epoch: number | null, lockName: string}} args - Fencing details.
     */
    constructor(message: string, { cause, currentEpoch, epoch, lockName }: {
        cause?: Error;
        currentEpoch: number | null;
        epoch: number | null;
        lockName: string;
    });
}
/**
 * Builds the error thrown when a lock name's minimum tier cannot be served and
 * no eligible tier is available (design §9, fail-closed).
 * @param {{lockName: string, minTier: import("./advisory-lock-backend-policy.js").AdvisoryLockTier, reasons: string[]}} args - Unavailability details.
 * @returns {AdvisoryLockBackendUnavailableError} - Error to throw.
 */
export declare function advisoryLockBackendUnavailable(args: {
    lockName: string;
    minTier: import("./advisory-lock-backend-policy.js").AdvisoryLockTier;
    reasons: string[];
}): AdvisoryLockBackendUnavailableError;
//# sourceMappingURL=advisory-lock-errors.d.ts.map