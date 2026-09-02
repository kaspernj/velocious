// @ts-check
/**
 * Explicit connection facade that tags operation-owned asynchronous work while
 * forwarding the driver's synchronous SQL-builder and capability APIs.
 */
export default class VelociousDatabaseOperationConnection {
    /**
     * Runs constructor.
     * @param {object} args - Connection ownership.
     * @param {import("./drivers/base.js").default} args.connection - Pinned physical connection.
     * @param {import("./operation.js").default} args.operation - Owning operation.
     * @param {symbol} args.owner - Opaque lease owner token.
     */
    constructor({ connection, operation, owner }) {
        this._physicalConnection = connection;
        this._operation = operation;
        this._owner = owner;
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (Reflect.has(target, property)) {
                    const value = Reflect.get(target, property, receiver);
                    return typeof value === "function" ? value.bind(target) : value;
                }
                const value = Reflect.get(connection, property, receiver);
                return typeof value === "function" ? value.bind(receiver) : value;
            },
            set: (target, property, value, receiver) => {
                if (Reflect.has(target, property)) {
                    return Reflect.set(target, property, value, receiver);
                }
                return Reflect.set(connection, property, value, connection);
            }
        });
    }
    /**
     * Runs a tagged SQL query on the pinned connection.
     * @param {string} sql - SQL string.
     * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<import("./drivers/base.js").QueryResultType>} - Query result.
     */
    async query(sql, options = {}) {
        this._operation.assertActive();
        return await this._physicalConnection.query(sql, { ...options, operationOwner: this._owner });
    }
    /**
     * Streams an operation-owned SQL query.
     * @param {string} sql - SQL string.
     * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
     * @yields {Record<string, unknown>} - Query rows.
     */
    async *queryStream(sql, options = {}) {
        this._operation.assertActive();
        yield* this._physicalConnection.queryStream(sql, { ...options, operationOwner: this._owner });
    }
    /**
     * Executes an operation-owned mutation and returns its affected row count.
     * @param {string} sql - Mutation SQL string.
     * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<number>} - Affected row count.
     */
    async affectedRows(sql, options = {}) {
        this._operation.assertActive();
        return await this._physicalConnection.affectedRows(sql, { ...options, operationOwner: this._owner });
    }
    /**
     * Runs an operation-owned transaction or nested savepoint.
     * @template T
     * @param {() => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    async transaction(callback) {
        this._operation.assertActive();
        return /** @type {Promise<T>} */ (this._physicalConnection.transaction(callback, { operationOwner: this._owner }));
    }
    /**
     * Registers an operation-owned before-commit guard.
     * @param {() => void | Promise<void>} callback - Guard callback.
     * @returns {Promise<void>} - Resolves after registration.
     */
    async beforeCommit(callback) {
        this._operation.assertActive();
        await this._physicalConnection.beforeCommit(callback, { operationOwner: this._owner });
    }
    /**
     * Registers an operation-owned after-commit callback.
     * @param {() => void | Promise<void>} callback - Callback.
     * @returns {Promise<void>} - Resolves after registration or execution.
     */
    async afterCommit(callback) {
        this._operation.assertActive();
        await this._physicalConnection.afterCommit(callback, { operationOwner: this._owner });
    }
    /**
     * Returns the last inserted identifier through the operation lease.
     * @returns {Promise<number>} - Last inserted identifier.
     */
    async lastInsertID() {
        this._operation.assertActive();
        return await this._physicalConnection.lastInsertID({ operationOwner: this._owner });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlcmF0aW9uLWNvbm5lY3Rpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2Uvb3BlcmF0aW9uLWNvbm5lY3Rpb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7R0FHRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0NBQW9DO0lBQ3ZEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQztRQUN4QyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsVUFBVSxDQUFBO1FBQ3JDLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO1FBQzNCLElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFBO1FBRW5CLE9BQU8sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFO1lBQ3JCLEdBQUcsRUFBRSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLEVBQUU7Z0JBQ2xDLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLEVBQUUsQ0FBQztvQkFDbEMsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFBO29CQUVyRCxPQUFPLE9BQU8sS0FBSyxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFBO2dCQUNqRSxDQUFDO2dCQUVELE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQTtnQkFFekQsT0FBTyxPQUFPLEtBQUssS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtZQUNuRSxD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QyxDQUFDLENBQUE7SUFDbkYsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogRXhwbGljaXQgY29ubmVjdGlvbiBmYWNhZGUgdGhhdCB0YWdzIG9wZXJhdGlvbi1vd25lZCBhc3luY2hyb25vdXMgd29yayB3aGlsZVxuICogZm9yd2FyZGluZyB0aGUgZHJpdmVyJ3Mgc3luY2hyb25vdXMgU1FMLWJ1aWxkZXIgYW5kIGNhcGFiaWxpdHkgQVBJcy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VPcGVyYXRpb25Db25uZWN0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29ubmVjdGlvbiBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5jb25uZWN0aW9uIC0gUGlubmVkIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5vcGVyYXRpb24gLSBPd25pbmcgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N5bWJvbH0gYXJncy5vd25lciAtIE9wYXF1ZSBsZWFzZSBvd25lciB0b2tlbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25uZWN0aW9uLCBvcGVyYXRpb24sIG93bmVyfSkge1xuICAgIHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbiA9IGNvbm5lY3Rpb25cbiAgICB0aGlzLl9vcGVyYXRpb24gPSBvcGVyYXRpb25cbiAgICB0aGlzLl9vd25lciA9IG93bmVyXG5cbiAgICByZXR1cm4gbmV3IFByb3h5KHRoaXMsIHtcbiAgICAgIGdldDogKHRhcmdldCwgcHJvcGVydHksIHJlY2VpdmVyKSA9PiB7XG4gICAgICAgIGlmIChSZWZsZWN0Lmhhcyh0YXJnZXQsIHByb3BlcnR5KSkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gUmVmbGVjdC5nZXQodGFyZ2V0LCBwcm9wZXJ0eSwgcmVjZWl2ZXIpXG5cbiAgICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgPyB2YWx1ZS5iaW5kKHRhcmdldCkgOiB2YWx1ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdmFsdWUgPSBSZWZsZWN0LmdldChjb25uZWN0aW9uLCBwcm9wZXJ0eSwgcmVjZWl2ZXIpXG5cbiAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiID8gdmFsdWUuYmluZChyZWNlaXZlcikgOiB2YWx1ZVxuICAgICAgfSxcbiAgICAgIHNldDogKHRhcmdldCwgcHJvcGVydHksIHZhbHVlLCByZWNlaXZlcikgPT4ge1xuICAgICAgICBpZiAoUmVmbGVjdC5oYXModGFyZ2V0LCBwcm9wZXJ0eSkpIHtcbiAgICAgICAgICByZXR1cm4gUmVmbGVjdC5zZXQodGFyZ2V0LCBwcm9wZXJ0eSwgdmFsdWUsIHJlY2VpdmVyKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFJlZmxlY3Quc2V0KGNvbm5lY3Rpb24sIHByb3BlcnR5LCB2YWx1ZSwgY29ubmVjdGlvbilcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSB0YWdnZWQgU1FMIHF1ZXJ5IG9uIHRoZSBwaW5uZWQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFF1ZXJ5IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHF1ZXJ5KHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5fb3BlcmF0aW9uLmFzc2VydEFjdGl2ZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uLnF1ZXJ5KHNxbCwgey4uLm9wdGlvbnMsIG9wZXJhdGlvbk93bmVyOiB0aGlzLl9vd25lcn0pXG4gIH1cblxuICAvKipcbiAgICogU3RyZWFtcyBhbiBvcGVyYXRpb24tb3duZWQgU1FMIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEB5aWVsZHMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIFF1ZXJ5IHJvd3MuXG4gICAqL1xuICBhc3luYyAqcXVlcnlTdHJlYW0oc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLl9vcGVyYXRpb24uYXNzZXJ0QWN0aXZlKClcblxuICAgIHlpZWxkKiB0aGlzLl9waHlzaWNhbENvbm5lY3Rpb24ucXVlcnlTdHJlYW0oc3FsLCB7Li4ub3B0aW9ucywgb3BlcmF0aW9uT3duZXI6IHRoaXMuX293bmVyfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhbiBvcGVyYXRpb24tb3duZWQgbXV0YXRpb24gYW5kIHJldHVybnMgaXRzIGFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIGFmZmVjdGVkUm93cyhzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMuX29wZXJhdGlvbi5hc3NlcnRBY3RpdmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbi5hZmZlY3RlZFJvd3Moc3FsLCB7Li4ub3B0aW9ucywgb3BlcmF0aW9uT3duZXI6IHRoaXMuX293bmVyfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIG9wZXJhdGlvbi1vd25lZCB0cmFuc2FjdGlvbiBvciBuZXN0ZWQgc2F2ZXBvaW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fb3BlcmF0aW9uLmFzc2VydEFjdGl2ZSgpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtQcm9taXNlPFQ+fSAqLyAodGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uLnRyYW5zYWN0aW9uKGNhbGxiYWNrLCB7b3BlcmF0aW9uT3duZXI6IHRoaXMuX293bmVyfSkpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFuIG9wZXJhdGlvbi1vd25lZCBiZWZvcmUtY29tbWl0IGd1YXJkLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIEd1YXJkIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBiZWZvcmVDb21taXQoY2FsbGJhY2spIHtcbiAgICB0aGlzLl9vcGVyYXRpb24uYXNzZXJ0QWN0aXZlKClcblxuICAgIGF3YWl0IHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbi5iZWZvcmVDb21taXQoY2FsbGJhY2ssIHtvcGVyYXRpb25Pd25lcjogdGhpcy5fb3duZXJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBvcGVyYXRpb24tb3duZWQgYWZ0ZXItY29tbWl0IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWdpc3RyYXRpb24gb3IgZXhlY3V0aW9uLlxuICAgKi9cbiAgYXN5bmMgYWZ0ZXJDb21taXQoY2FsbGJhY2spIHtcbiAgICB0aGlzLl9vcGVyYXRpb24uYXNzZXJ0QWN0aXZlKClcblxuICAgIGF3YWl0IHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbi5hZnRlckNvbW1pdChjYWxsYmFjaywge29wZXJhdGlvbk93bmVyOiB0aGlzLl9vd25lcn0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGFzdCBpbnNlcnRlZCBpZGVudGlmaWVyIHRocm91Z2ggdGhlIG9wZXJhdGlvbiBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBMYXN0IGluc2VydGVkIGlkZW50aWZpZXIuXG4gICAqL1xuICBhc3luYyBsYXN0SW5zZXJ0SUQoKSB7XG4gICAgdGhpcy5fb3BlcmF0aW9uLmFzc2VydEFjdGl2ZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uLmxhc3RJbnNlcnRJRCh7b3BlcmF0aW9uT3duZXI6IHRoaXMuX293bmVyfSlcbiAgfVxufVxuIl19