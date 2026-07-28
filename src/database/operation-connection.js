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
  constructor({connection, operation, owner}) {
    this._physicalConnection = connection
    this._operation = operation
    this._owner = owner

    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (Reflect.has(target, property)) {
          const value = Reflect.get(target, property, receiver)

          return typeof value === "function" ? value.bind(target) : value
        }

        const value = Reflect.get(connection, property, receiver)

        return typeof value === "function" ? value.bind(receiver) : value
      },
      set: (target, property, value, receiver) => {
        if (Reflect.has(target, property)) {
          return Reflect.set(target, property, value, receiver)
        }

        return Reflect.set(connection, property, value, connection)
      }
    })
  }

  /**
   * Runs a tagged SQL query on the pinned connection.
   * @param {string} sql - SQL string.
   * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
   * @returns {Promise<import("./drivers/base.js").QueryResultType>} - Query result.
   */
  async query(sql, options = {}) {
    this._operation.assertActive()

    return await this._physicalConnection.query(sql, {...options, operationOwner: this._owner})
  }

  /**
   * Streams an operation-owned SQL query.
   * @param {string} sql - SQL string.
   * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
   * @yields {Record<string, unknown>} - Query rows.
   */
  async *queryStream(sql, options = {}) {
    this._operation.assertActive()

    yield* this._physicalConnection.queryStream(sql, {...options, operationOwner: this._owner})
  }

  /**
   * Executes an operation-owned mutation and returns its affected row count.
   * @param {string} sql - Mutation SQL string.
   * @param {import("./drivers/base.js").QueryOptions} [options] - Query options.
   * @returns {Promise<number>} - Affected row count.
   */
  async affectedRows(sql, options = {}) {
    this._operation.assertActive()

    return await this._physicalConnection.affectedRows(sql, {...options, operationOwner: this._owner})
  }

  /**
   * Runs an operation-owned transaction or nested savepoint.
   * @template T
   * @param {() => Promise<T>} callback - Transaction callback.
   * @returns {Promise<T>} - Callback result.
   */
  async transaction(callback) {
    this._operation.assertActive()

    return /** @type {Promise<T>} */ (this._physicalConnection.transaction(callback, {operationOwner: this._owner}))
  }

  /**
   * Registers an operation-owned after-commit callback.
   * @param {() => void | Promise<void>} callback - Callback.
   * @returns {Promise<void>} - Resolves after registration or execution.
   */
  async afterCommit(callback) {
    this._operation.assertActive()

    await this._physicalConnection.afterCommit(callback, {operationOwner: this._owner})
  }

  /**
   * Returns the last inserted identifier through the operation lease.
   * @returns {Promise<number>} - Last inserted identifier.
   */
  async lastInsertID() {
    this._operation.assertActive()

    return await this._physicalConnection.lastInsertID({operationOwner: this._owner})
  }
}
