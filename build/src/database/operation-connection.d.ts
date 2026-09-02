/**
 * Explicit connection facade that tags operation-owned asynchronous work while
 * forwarding the driver's synchronous SQL-builder and capability APIs.
 */
export default class VelociousDatabaseOperationConnection {
    _physicalConnection: import("./drivers/base.js").default;
    _operation: import("./operation.js").default;
    _owner: symbol;
    /**
     * Runs constructor.
     * @param {object} args - Connection ownership.
     * @param {import("./drivers/base.js").default} args.connection - Pinned physical connection.
     * @param {import("./operation.js").default} args.operation - Owning operation.
     * @param {symbol} args.owner - Opaque lease owner token.
     */
    constructor({ connection, operation, owner }: {
        connection: import("./drivers/base.js").default;
        operation: import("./operation.js").default;
        owner: symbol;
    });
    /**
     * Runs a tagged SQL query on the pinned connection.
     * @param {string} sql - SQL string.
     * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<import("./drivers/base.js").QueryResultType>} - Query result.
     */
    query(sql: string, options?: import("./drivers/base.js").QueryOptions): Promise<import("./drivers/base.js").QueryResultType>;
    /**
     * Streams an operation-owned SQL query.
     * @param {string} sql - SQL string.
     * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
     * @yields {Record<string, unknown>} - Query rows.
     */
    queryStream(sql: string, options?: import("./drivers/base.js").QueryOptions): AsyncGenerator<import("./drivers/base.js").QueryRowType, void, unknown>;
    /**
     * Executes an operation-owned mutation and returns its affected row count.
     * @param {string} sql - Mutation SQL string.
     * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<number>} - Affected row count.
     */
    affectedRows(sql: string, options?: import("./drivers/base.js").QueryOptions): Promise<number>;
    /**
     * Runs an operation-owned transaction or nested savepoint.
     * @template T
     * @param {() => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    transaction<T>(callback: () => Promise<T>): Promise<T>;
    /**
     * Registers an operation-owned before-commit guard.
     * @param {() => void | Promise<void>} callback - Guard callback.
     * @returns {Promise<void>} - Resolves after registration.
     */
    beforeCommit(callback: () => void | Promise<void>): Promise<void>;
    /**
     * Registers an operation-owned after-commit callback.
     * @param {() => void | Promise<void>} callback - Callback.
     * @returns {Promise<void>} - Resolves after registration or execution.
     */
    afterCommit(callback: () => void | Promise<void>): Promise<void>;
    /**
     * Returns the last inserted identifier through the operation lease.
     * @returns {Promise<number>} - Last inserted identifier.
     */
    lastInsertID(): Promise<number>;
}
//# sourceMappingURL=operation-connection.d.ts.map