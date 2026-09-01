// @ts-check
/**
 * Attempts every shutdown step and preserves failures in execution order.
 * Caught values are intentionally opaque because JavaScript permits throwing
 * values that are not `Error` instances.
 * @param {object} args - Shutdown steps.
 * @param {string} args.message - Aggregate error message.
 * @param {Array<() => void | Promise<void>>} args.steps - Ordered steps to attempt.
 * @returns {Promise<void>} - Resolves when every step succeeds.
 */
export async function runShutdownSteps({ message, steps }) {
    /** @type {unknown[]} */
    const errors = [];
    for (const step of steps) {
        try {
            await step();
        }
        catch (error) {
            if (error instanceof AggregateError && error.errors.length > 0) {
                errors.push(...error.errors);
            }
            else {
                errors.push(error);
            }
        }
    }
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new AggregateError(errors, message, { cause: errors[0] });
}
/**
 * Runs service shutdown and its completion hook while preserving both failures.
 * @param {object} args - Lifecycle callbacks.
 * @param {() => Promise<void>} args.shutdown - Primary service shutdown.
 * @param {() => void | Promise<void>} [args.onStopped] - Completion hook.
 * @returns {Promise<void>} - Resolves after shutdown and the hook finish.
 */
export default async function shutdownLifecycle({ shutdown, onStopped }) {
    await runShutdownSteps({
        message: "Service shutdown and onStopped hook failed",
        steps: [shutdown, async () => await onStopped?.()]
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2h1dGRvd24tbGlmZWN5Y2xlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLGdCQUFnQixDQUFDLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBQztJQUNyRCx3QkFBd0I7SUFDeEIsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO0lBRWpCLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7UUFDekIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLEVBQUUsQ0FBQTtRQUNkLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksY0FBYyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUMvRCxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQzlCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3BCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDO1FBQUUsTUFBTSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDeEMsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7UUFBRSxNQUFNLElBQUksY0FBYyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFDLENBQUMsQ0FBQTtBQUN0RixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFVBQVUsaUJBQWlCLENBQUMsRUFBQyxRQUFRLEVBQUUsU0FBUyxFQUFDO0lBQ25FLE1BQU0sZ0JBQWdCLENBQUM7UUFDckIsT0FBTyxFQUFFLDRDQUE0QztRQUNyRCxLQUFLLEVBQUUsQ0FBQyxRQUFRLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLFNBQVMsRUFBRSxFQUFFLENBQUM7S0FDbkQsQ0FBQyxDQUFBO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEF0dGVtcHRzIGV2ZXJ5IHNodXRkb3duIHN0ZXAgYW5kIHByZXNlcnZlcyBmYWlsdXJlcyBpbiBleGVjdXRpb24gb3JkZXIuXG4gKiBDYXVnaHQgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIEphdmFTY3JpcHQgcGVybWl0cyB0aHJvd2luZ1xuICogdmFsdWVzIHRoYXQgYXJlIG5vdCBgRXJyb3JgIGluc3RhbmNlcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2h1dGRvd24gc3RlcHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXNzYWdlIC0gQWdncmVnYXRlIGVycm9yIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge0FycmF5PCgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+Pn0gYXJncy5zdGVwcyAtIE9yZGVyZWQgc3RlcHMgdG8gYXR0ZW1wdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgc3RlcCBzdWNjZWVkcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blNodXRkb3duU3RlcHMoe21lc3NhZ2UsIHN0ZXBzfSkge1xuICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgY29uc3QgZXJyb3JzID0gW11cblxuICBmb3IgKGNvbnN0IHN0ZXAgb2Ygc3RlcHMpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RlcCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEFnZ3JlZ2F0ZUVycm9yICYmIGVycm9yLmVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKC4uLmVycm9yLmVycm9ycylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBtZXNzYWdlLCB7Y2F1c2U6IGVycm9yc1swXX0pXG59XG5cbi8qKlxuICogUnVucyBzZXJ2aWNlIHNodXRkb3duIGFuZCBpdHMgY29tcGxldGlvbiBob29rIHdoaWxlIHByZXNlcnZpbmcgYm90aCBmYWlsdXJlcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTGlmZWN5Y2xlIGNhbGxiYWNrcy5cbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5zaHV0ZG93biAtIFByaW1hcnkgc2VydmljZSBzaHV0ZG93bi5cbiAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBDb21wbGV0aW9uIGhvb2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzaHV0ZG93biBhbmQgdGhlIGhvb2sgZmluaXNoLlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBzaHV0ZG93bkxpZmVjeWNsZSh7c2h1dGRvd24sIG9uU3RvcHBlZH0pIHtcbiAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgbWVzc2FnZTogXCJTZXJ2aWNlIHNodXRkb3duIGFuZCBvblN0b3BwZWQgaG9vayBmYWlsZWRcIixcbiAgICBzdGVwczogW3NodXRkb3duLCBhc3luYyAoKSA9PiBhd2FpdCBvblN0b3BwZWQ/LigpXVxuICB9KVxufVxuIl19