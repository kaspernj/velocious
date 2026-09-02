// @ts-check
import timeout from "awaitery/build/timeout.js";
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
export default async function runWithTransportDeadline({ timeoutMs, signal, errorMessage }, operation) {
    if (!(typeof timeoutMs === "number" && timeoutMs > 0)) {
        // No deadline: run under the caller signal if provided, else a never-aborting signal.
        return await operation(signal || new AbortController().signal);
    }
    return await timeout({ errorMessage: errorMessage || "Transport request timed out", timeout: timeoutMs }, async ({ control }) => {
        if (!signal) {
            return await operation(control.signal);
        }
        // A caller that has already cancelled must not start a live request.
        if (signal.aborted) {
            throw signal.reason instanceof Error ? signal.reason : new Error("Transport request aborted");
        }
        // Compose the caller/session signal with awaitery's deadline signal: either
        // one aborts the live operation, and the composed listeners are always removed.
        const callerSignal = signal;
        const composed = new AbortController();
        /**
         * Aborts the composed operation when the deadline signal fires.
         * @returns {void} - No return value.
         */
        const onDeadlineAbort = () => composed.abort(control.signal.reason);
        /**
         * Aborts the composed operation when the caller signal fires.
         * @returns {void} - No return value.
         */
        const onCallerAbort = () => composed.abort(callerSignal.reason);
        control.signal.addEventListener("abort", onDeadlineAbort);
        callerSignal.addEventListener("abort", onCallerAbort);
        try {
            return await operation(composed.signal);
        }
        finally {
            control.signal.removeEventListener("abort", onDeadlineAbort);
            callerSignal.removeEventListener("abort", onCallerAbort);
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNwb3J0LWRlYWRsaW5lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy90cmFuc3BvcnQtZGVhZGxpbmUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBRS9DOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUsd0JBQXdCLENBQUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBQyxFQUFFLFNBQVM7SUFDakcsSUFBSSxDQUFDLENBQUMsT0FBTyxTQUFTLEtBQUssUUFBUSxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3RELHNGQUFzRjtRQUN0RixPQUFPLE1BQU0sU0FBUyxDQUFDLE1BQU0sSUFBSSxJQUFJLGVBQWUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRCxPQUFPLE1BQU0sT0FBTyxDQUFDLEVBQUMsWUFBWSxFQUFFLFlBQVksSUFBSSw2QkFBNkIsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUMsT0FBTyxFQUFDLEVBQUUsRUFBRTtRQUMxSCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixPQUFPLE1BQU0sU0FBUyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUN4QyxDQUFDO1FBRUQscUVBQXFFO1FBQ3JFLElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ25CLE1BQU0sTUFBTSxDQUFDLE1BQU0sWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELDRFQUE0RTtRQUM1RSxnRkFBZ0Y7UUFDaEYsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFBO1FBQzNCLE1BQU0sUUFBUSxHQUFHLElBQUksZUFBZSxFQUFFLENBQUE7UUFDdEM7OztXQUdHO1FBQ0gsTUFBTSxlQUFlLEdBQUcsR0FBRyxFQUFFLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ25FOzs7V0FHRztRQUNILE1BQU0sYUFBYSxHQUFHLEdBQUcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRS9ELE9BQU8sQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBQ3pELFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFFckQsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLFNBQVMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDekMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsT0FBTyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsZUFBZSxDQUFDLENBQUE7WUFDNUQsWUFBWSxDQUFDLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUMsQ0FBQTtRQUMxRCxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcblxuLyoqXG4gKiBSdW5zIGFuIGFzeW5jIHRyYW5zcG9ydCBvcGVyYXRpb24gdW5kZXIgYSBib3VuZGVkIGRlYWRsaW5lIGJ1aWx0IG9uIGF3YWl0ZXJ5J3NcbiAqIGB0aW1lb3V0YCwgd2hpY2ggb3ducyB0aGUgdGltZXIsIHRoZSBzdGFibGUgYFRpbWVvdXRFcnJvcmAsIGFuZCB0aGUgdGltZXJcbiAqIGNsZWFudXAuIGF3YWl0ZXJ5J3MgZGVhZGxpbmUgYEFib3J0U2lnbmFsYCBpcyBoYW5kZWQgdG8gYG9wZXJhdGlvbmAgKGNvbXBvc2VkXG4gKiB3aXRoIGFuIG9wdGlvbmFsIGNhbGxlci9zZXNzaW9uIHNpZ25hbCkgc28gdGhlIGxpdmUgcmVxdWVzdCDigJQgYW5kIGl0c1xuICogcmVzcG9uc2UtYm9keSByZWFkIOKAlCBpcyBhY3R1YWxseSBhYm9ydGVkIHdoZW4gdGhlIGRlYWRsaW5lIGV4cGlyZXMsIG5vdCBtZXJlbHlcbiAqIGxlZnQgcmFjaW5nIGEgd3JhcHBlciBwcm9taXNlLlxuICpcbiAqIEEgZGVhZGxpbmUgZXhwaXJ5IHJlamVjdHMgd2l0aCBhd2FpdGVyeSdzIGBUaW1lb3V0RXJyb3JgXG4gKiAoYGltcG9ydCB7VGltZW91dEVycm9yfSBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiYCksIHNvIGNhbGxlcnMgY2FuXG4gKiBjbGFzc2lmeSBhIHRpbWVvdXQgd2l0aG91dCBwYXJzaW5nIGJyb3dzZXIvbmV0d29yayBlcnJvciB0ZXh0LiBBIGNhbGxlciBhYm9ydFxuICogcmVqZWN0cyB3aXRoIHRoZSBjYWxsZXIncyBvd24gcmVhc29uLCBrZWVwaW5nIHRoZSB0d28gZGlzdGluZ3Vpc2hhYmxlLiBCb3RoIHRoZVxuICogYXdhaXRlcnkgdGltZXIgYW5kIHRoZSBjb21wb3NlZCBhYm9ydCBsaXN0ZW5lcnMgYXJlIGFsd2F5cyBjbGVhbmVkIHVwLiBXaXRoIG5vXG4gKiBwb3NpdGl2ZSBgdGltZW91dE1zYCB0aGUgb3BlcmF0aW9uIHJ1bnMgZGlyZWN0bHkgdW5kZXIgdGhlIGNhbGxlciBzaWduYWwgKG9yIG5vXG4gKiBzaWduYWwpIGFuZCBubyB0aW1lciBpcyBhcm1lZC5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBzaWduYWw/OiBBYm9ydFNpZ25hbCB8IG51bGwsIGVycm9yTWVzc2FnZT86IHN0cmluZ319IG9wdGlvbnMgLSBEZWFkbGluZSBvcHRpb25zLlxuICogQHBhcmFtIHsoc2lnbmFsOiBBYm9ydFNpZ25hbCkgPT4gUHJvbWlzZTxUPn0gb3BlcmF0aW9uIC0gVHJhbnNwb3J0IG9wZXJhdGlvbiByZWNlaXZpbmcgdGhlIGNvbXBvc2VkIHNpZ25hbC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFRoZSBvcGVyYXRpb24gcmVzdWx0LlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoe3RpbWVvdXRNcywgc2lnbmFsLCBlcnJvck1lc3NhZ2V9LCBvcGVyYXRpb24pIHtcbiAgaWYgKCEodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwKSkge1xuICAgIC8vIE5vIGRlYWRsaW5lOiBydW4gdW5kZXIgdGhlIGNhbGxlciBzaWduYWwgaWYgcHJvdmlkZWQsIGVsc2UgYSBuZXZlci1hYm9ydGluZyBzaWduYWwuXG4gICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbihzaWduYWwgfHwgbmV3IEFib3J0Q29udHJvbGxlcigpLnNpZ25hbClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCB0aW1lb3V0KHtlcnJvck1lc3NhZ2U6IGVycm9yTWVzc2FnZSB8fCBcIlRyYW5zcG9ydCByZXF1ZXN0IHRpbWVkIG91dFwiLCB0aW1lb3V0OiB0aW1lb3V0TXN9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiB7XG4gICAgaWYgKCFzaWduYWwpIHtcbiAgICAgIHJldHVybiBhd2FpdCBvcGVyYXRpb24oY29udHJvbC5zaWduYWwpXG4gICAgfVxuXG4gICAgLy8gQSBjYWxsZXIgdGhhdCBoYXMgYWxyZWFkeSBjYW5jZWxsZWQgbXVzdCBub3Qgc3RhcnQgYSBsaXZlIHJlcXVlc3QuXG4gICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICB0aHJvdyBzaWduYWwucmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyBzaWduYWwucmVhc29uIDogbmV3IEVycm9yKFwiVHJhbnNwb3J0IHJlcXVlc3QgYWJvcnRlZFwiKVxuICAgIH1cblxuICAgIC8vIENvbXBvc2UgdGhlIGNhbGxlci9zZXNzaW9uIHNpZ25hbCB3aXRoIGF3YWl0ZXJ5J3MgZGVhZGxpbmUgc2lnbmFsOiBlaXRoZXJcbiAgICAvLyBvbmUgYWJvcnRzIHRoZSBsaXZlIG9wZXJhdGlvbiwgYW5kIHRoZSBjb21wb3NlZCBsaXN0ZW5lcnMgYXJlIGFsd2F5cyByZW1vdmVkLlxuICAgIGNvbnN0IGNhbGxlclNpZ25hbCA9IHNpZ25hbFxuICAgIGNvbnN0IGNvbXBvc2VkID0gbmV3IEFib3J0Q29udHJvbGxlcigpXG4gICAgLyoqXG4gICAgICogQWJvcnRzIHRoZSBjb21wb3NlZCBvcGVyYXRpb24gd2hlbiB0aGUgZGVhZGxpbmUgc2lnbmFsIGZpcmVzLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICAgKi9cbiAgICBjb25zdCBvbkRlYWRsaW5lQWJvcnQgPSAoKSA9PiBjb21wb3NlZC5hYm9ydChjb250cm9sLnNpZ25hbC5yZWFzb24pXG4gICAgLyoqXG4gICAgICogQWJvcnRzIHRoZSBjb21wb3NlZCBvcGVyYXRpb24gd2hlbiB0aGUgY2FsbGVyIHNpZ25hbCBmaXJlcy5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAgICovXG4gICAgY29uc3Qgb25DYWxsZXJBYm9ydCA9ICgpID0+IGNvbXBvc2VkLmFib3J0KGNhbGxlclNpZ25hbC5yZWFzb24pXG5cbiAgICBjb250cm9sLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25EZWFkbGluZUFib3J0KVxuICAgIGNhbGxlclNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25DYWxsZXJBYm9ydClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgb3BlcmF0aW9uKGNvbXBvc2VkLnNpZ25hbClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29udHJvbC5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uRGVhZGxpbmVBYm9ydClcbiAgICAgIGNhbGxlclNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25DYWxsZXJBYm9ydClcbiAgICB9XG4gIH0pXG59XG4iXX0=