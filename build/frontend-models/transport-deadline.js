// @ts-check

import timeout from "awaitery/build/timeout.js"

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
export default async function runWithTransportDeadline({timeoutMs, signal, errorMessage}, operation) {
  if (!(typeof timeoutMs === "number" && timeoutMs > 0)) {
    // No deadline: run under the caller signal if provided, else a never-aborting signal.
    return await operation(signal || new AbortController().signal)
  }

  return await timeout({errorMessage: errorMessage || "Transport request timed out", timeout: timeoutMs}, async ({control}) => {
    if (!signal) {
      return await operation(control.signal)
    }

    // A caller that has already cancelled must not start a live request.
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("Transport request aborted")
    }

    // Compose the caller/session signal with awaitery's deadline signal: either
    // one aborts the live operation, and the composed listeners are always removed.
    const callerSignal = signal
    const composed = new AbortController()
    /**
     * Aborts the composed operation when the deadline signal fires.
     * @returns {void} - No return value.
     */
    const onDeadlineAbort = () => composed.abort(control.signal.reason)
    /**
     * Aborts the composed operation when the caller signal fires.
     * @returns {void} - No return value.
     */
    const onCallerAbort = () => composed.abort(callerSignal.reason)

    control.signal.addEventListener("abort", onDeadlineAbort)
    callerSignal.addEventListener("abort", onCallerAbort)

    try {
      return await operation(composed.signal)
    } finally {
      control.signal.removeEventListener("abort", onDeadlineAbort)
      callerSignal.removeEventListener("abort", onCallerAbort)
    }
  })
}
