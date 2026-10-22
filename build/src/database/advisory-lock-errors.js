// @ts-check
import { AdvisoryLockBackendUnavailableError } from "./advisory-lock-backend-policy.js";
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
    constructor(message, { lockName, reason }) {
        super(message);
        this.name = "AdvisoryLockServiceUnavailableError";
        this.lockName = lockName;
        this.reason = reason;
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
    constructor(message, { cause, currentEpoch, epoch, lockName }) {
        super(message);
        this.name = "AdvisoryLockLostError";
        this.lockName = lockName;
        this.epoch = epoch;
        this.currentEpoch = currentEpoch;
        this.cause = cause;
    }
}
/**
 * Builds the error thrown when a lock name's minimum tier cannot be served and
 * no eligible tier is available (design §9, fail-closed).
 * @param {{lockName: string, minTier: import("./advisory-lock-backend-policy.js").AdvisoryLockTier, reasons: string[]}} args - Unavailability details.
 * @returns {AdvisoryLockBackendUnavailableError} - Error to throw.
 */
export function advisoryLockBackendUnavailable(args) {
    const { lockName, minTier, reasons } = args;
    return new AdvisoryLockBackendUnavailableError(`No eligible advisory-lock backend is available for ${JSON.stringify(lockName)} (minimum tier ${JSON.stringify(minTier)}): ${reasons.join("; ")}`, { lockName, minTier, reasons });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2aXNvcnktbG9jay1lcnJvcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvYWR2aXNvcnktbG9jay1lcnJvcnMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxtQ0FBbUMsRUFBQyxNQUFNLG1DQUFtQyxDQUFBO0FBRXJGOzs7OztHQUtHO0FBQ0gsTUFBTSxPQUFPLG1DQUFvQyxTQUFRLEtBQUs7SUFDNUQ7Ozs7T0FJRztJQUNILFlBQVksT0FBTyxFQUFFLEVBQUMsUUFBUSxFQUFFLE1BQU0sRUFBQztRQUNyQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLHFDQUFxQyxDQUFBO1FBQ2pELElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO0lBQ3RCLENBQUM7Q0FDRjtBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLE9BQU8scUJBQXNCLFNBQVEsS0FBSztJQUM5Qzs7OztPQUlHO0lBQ0gsWUFBWSxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUM7UUFDekQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyx1QkFBdUIsQ0FBQTtRQUNuQyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUN4QixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtRQUNsQixJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQTtJQUNwQixDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSw4QkFBOEIsQ0FBQyxJQUFJO0lBQ2pELE1BQU0sRUFBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBQyxHQUFHLElBQUksQ0FBQTtJQUV6QyxPQUFPLElBQUksbUNBQW1DLENBQzVDLHNEQUFzRCxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQ2pKLEVBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUMsQ0FDN0IsQ0FBQTtBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvcn0gZnJvbSBcIi4vYWR2aXNvcnktbG9jay1iYWNrZW5kLXBvbGljeS5qc1wiXG5cbi8qKlxuICogVGhyb3duIHdoZW4gYSBsb2NrLXNlcnZlciBhY3F1aXNpdGlvbiBjb3VsZCBub3QgYmUgYXR0ZW1wdGVkIGJlY2F1c2UgdGhlXG4gKiBsb2NrIHNlcnZlciBpcyB1bnJlYWNoYWJsZS4gRGlzdGluY3QgZnJvbSBgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yYCAoXCJ0aGVcbiAqIHNlcnZlciB3YXMgcmVhY2hhYmxlLCB0aGUgaG9sZGVyIG5ldmVyIHJlbGVhc2VkXCIpIHNvIGEgY2FsbGVyIGNhbiByZWFjdCB0b1xuICogYW4gaW5mcmFzdHJ1Y3R1cmUgb3V0YWdlIHdpdGhvdXQgZ3Vlc3NpbmcuXG4gKi9cbmV4cG9ydCBjbGFzcyBBZHZpc29yeUxvY2tTZXJ2aWNlVW5hdmFpbGFibGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bG9ja05hbWU6IHN0cmluZywgcmVhc29uOiBzdHJpbmd9fSBhcmdzIC0gTG9jayBuYW1lIGFuZCBmYWlsdXJlIHJlYXNvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UsIHtsb2NrTmFtZSwgcmVhc29ufSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gXCJBZHZpc29yeUxvY2tTZXJ2aWNlVW5hdmFpbGFibGVFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IGxvY2tOYW1lXG4gICAgdGhpcy5yZWFzb24gPSByZWFzb25cbiAgfVxufVxuXG4vKipcbiAqIFRocm93biBhZnRlciBhIGNyaXRpY2FsIHNlY3Rpb24gcmFuIG9uIHRoZSBsb2NrLXNlcnZlciB0aWVyIHdoaWxlIGl0cyBsZWFzZVxuICogd2FzIGZlbmNlZCBvciBsb3N0IChkZXNpZ24gwqc3L8KnOCk6IHRoZSBzZWN0aW9uIG1heSBoYXZlIG92ZXJsYXBwZWQgYW5vdGhlclxuICogaG9sZGVyLCBzbyBpdHMgcmVzdWx0IG11c3Qgbm90IGJlIHRydXN0ZWQgYXMgZXhjbHVzaXZlLlxuICovXG5leHBvcnQgY2xhc3MgQWR2aXNvcnlMb2NrTG9zdEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tjYXVzZT86IEVycm9yLCBjdXJyZW50RXBvY2g6IG51bWJlciB8IG51bGwsIGVwb2NoOiBudW1iZXIgfCBudWxsLCBsb2NrTmFtZTogc3RyaW5nfX0gYXJncyAtIEZlbmNpbmcgZGV0YWlscy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UsIHtjYXVzZSwgY3VycmVudEVwb2NoLCBlcG9jaCwgbG9ja05hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIkFkdmlzb3J5TG9ja0xvc3RFcnJvclwiXG4gICAgdGhpcy5sb2NrTmFtZSA9IGxvY2tOYW1lXG4gICAgdGhpcy5lcG9jaCA9IGVwb2NoXG4gICAgdGhpcy5jdXJyZW50RXBvY2ggPSBjdXJyZW50RXBvY2hcbiAgICB0aGlzLmNhdXNlID0gY2F1c2VcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyB0aGUgZXJyb3IgdGhyb3duIHdoZW4gYSBsb2NrIG5hbWUncyBtaW5pbXVtIHRpZXIgY2Fubm90IGJlIHNlcnZlZCBhbmRcbiAqIG5vIGVsaWdpYmxlIHRpZXIgaXMgYXZhaWxhYmxlIChkZXNpZ24gwqc5LCBmYWlsLWNsb3NlZCkuXG4gKiBAcGFyYW0ge3tsb2NrTmFtZTogc3RyaW5nLCBtaW5UaWVyOiBpbXBvcnQoXCIuL2Fkdmlzb3J5LWxvY2stYmFja2VuZC1wb2xpY3kuanNcIikuQWR2aXNvcnlMb2NrVGllciwgcmVhc29uczogc3RyaW5nW119fSBhcmdzIC0gVW5hdmFpbGFiaWxpdHkgZGV0YWlscy5cbiAqIEByZXR1cm5zIHtBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvcn0gLSBFcnJvciB0byB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3J5TG9ja0JhY2tlbmRVbmF2YWlsYWJsZShhcmdzKSB7XG4gIGNvbnN0IHtsb2NrTmFtZSwgbWluVGllciwgcmVhc29uc30gPSBhcmdzXG5cbiAgcmV0dXJuIG5ldyBBZHZpc29yeUxvY2tCYWNrZW5kVW5hdmFpbGFibGVFcnJvcihcbiAgICBgTm8gZWxpZ2libGUgYWR2aXNvcnktbG9jayBiYWNrZW5kIGlzIGF2YWlsYWJsZSBmb3IgJHtKU09OLnN0cmluZ2lmeShsb2NrTmFtZSl9IChtaW5pbXVtIHRpZXIgJHtKU09OLnN0cmluZ2lmeShtaW5UaWVyKX0pOiAke3JlYXNvbnMuam9pbihcIjsgXCIpfWAsXG4gICAge2xvY2tOYW1lLCBtaW5UaWVyLCByZWFzb25zfVxuICApXG59XG4iXX0=