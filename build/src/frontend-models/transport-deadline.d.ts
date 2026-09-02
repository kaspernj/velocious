/**
 * Runs an async transport operation under a bounded deadline built on awaitery's
 * `timeout`, which owns the timer, the stable `TimeoutError`, and the timer
 * cleanup. awaitery's deadline `AbortSignal` is handed to `operation` (composed
 * with an optional caller/session signal) so the live request — and its
 * response-body read — is actually aborted when the deadline expires, not merely
 * left racing a wrapper promise.
 *
 * A deadline expiry rejects with awaitery's `TimeoutError`
 * (`import {TimeoutError} from "awaitery/build/timeout.js"`), so callers can
 * classify a timeout without parsing browser/network error text. A caller abort
 * rejects with the caller's own reason, keeping the two distinguishable. Both the
 * awaitery timer and the composed abort listeners are always cleaned up. With no
 * positive `timeoutMs` the operation runs directly under the caller signal (or no
 * signal) and no timer is armed.
 * @template T
 * @param {{timeoutMs?: number | null, signal?: AbortSignal | null, errorMessage?: string}} options - Deadline options.
 * @param {(signal: AbortSignal) => Promise<T>} operation - Transport operation receiving the composed signal.
 * @returns {Promise<T>} - The operation result.
 */
export default function runWithTransportDeadline<T>({ timeoutMs, signal, errorMessage }: {
    timeoutMs?: number | null;
    signal?: AbortSignal | null;
    errorMessage?: string;
}, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
//# sourceMappingURL=transport-deadline.d.ts.map