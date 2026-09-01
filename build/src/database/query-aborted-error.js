// @ts-check
/**
 * Thrown when a query is aborted via its `AbortSignal`/deadline. This is a
 * terminal, non-retryable outcome whether cancellation happened before checkout
 * or after an in-flight connection had to be destroyed.
 */
export default class QueryAbortedError extends Error {
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {unknown} [args.cause] - Error cause.
     * @param {boolean} [args.connectionDestroyed] - Whether cancellation destroyed an in-flight connection.
     * @param {string} [args.sql] - The SQL that was aborted.
     */
    constructor({ cause, connectionDestroyed = false, sql } = {}) {
        super("Query aborted before it completed", { cause });
        this.name = "QueryAbortedError";
        this.code = "VELOCIOUS_QUERY_ABORTED";
        this.connectionDestroyed = connectionDestroyed;
        this.sql = sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktYWJvcnRlZC1lcnJvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS1hYm9ydGVkLWVycm9yLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxpQkFBa0IsU0FBUSxLQUFLO0lBQ2xEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxLQUFLLEVBQUUsbUJBQW1CLEdBQUcsS0FBSyxFQUFFLEdBQUcsRUFBQyxHQUFHLEVBQUU7UUFDeEQsS0FBSyxDQUFDLG1DQUFtQyxFQUFFLEVBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUVuRCxJQUFJLENBQUMsSUFBSSxHQUFHLG1CQUFtQixDQUFBO1FBQy9CLElBQUksQ0FBQyxJQUFJLEdBQUcseUJBQXlCLENBQUE7UUFDckMsSUFBSSxDQUFDLG1CQUFtQixHQUFHLG1CQUFtQixDQUFBO1FBQzlDLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFBO0lBQ2hCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFRocm93biB3aGVuIGEgcXVlcnkgaXMgYWJvcnRlZCB2aWEgaXRzIGBBYm9ydFNpZ25hbGAvZGVhZGxpbmUuIFRoaXMgaXMgYVxuICogdGVybWluYWwsIG5vbi1yZXRyeWFibGUgb3V0Y29tZSB3aGV0aGVyIGNhbmNlbGxhdGlvbiBoYXBwZW5lZCBiZWZvcmUgY2hlY2tvdXRcbiAqIG9yIGFmdGVyIGFuIGluLWZsaWdodCBjb25uZWN0aW9uIGhhZCB0byBiZSBkZXN0cm95ZWQuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFF1ZXJ5QWJvcnRlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gW2FyZ3MuY2F1c2VdIC0gRXJyb3IgY2F1c2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY29ubmVjdGlvbkRlc3Ryb3llZF0gLSBXaGV0aGVyIGNhbmNlbGxhdGlvbiBkZXN0cm95ZWQgYW4gaW4tZmxpZ2h0IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zcWxdIC0gVGhlIFNRTCB0aGF0IHdhcyBhYm9ydGVkLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NhdXNlLCBjb25uZWN0aW9uRGVzdHJveWVkID0gZmFsc2UsIHNxbH0gPSB7fSkge1xuICAgIHN1cGVyKFwiUXVlcnkgYWJvcnRlZCBiZWZvcmUgaXQgY29tcGxldGVkXCIsIHtjYXVzZX0pXG5cbiAgICB0aGlzLm5hbWUgPSBcIlF1ZXJ5QWJvcnRlZEVycm9yXCJcbiAgICB0aGlzLmNvZGUgPSBcIlZFTE9DSU9VU19RVUVSWV9BQk9SVEVEXCJcbiAgICB0aGlzLmNvbm5lY3Rpb25EZXN0cm95ZWQgPSBjb25uZWN0aW9uRGVzdHJveWVkXG4gICAgdGhpcy5zcWwgPSBzcWxcbiAgfVxufVxuIl19