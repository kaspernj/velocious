// @ts-check

import timeout from "awaitery/build/timeout.js"

/**
 * Thrown when an advisory lock could not be acquired before `timeoutMs` elapsed.
 */
class AdvisoryLockTimeoutError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name that timed out.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockTimeoutError"
    this.lockName = name
  }
}

/**
 * Thrown when `withAdvisoryLockOrFail` finds the lock already held.
 */
class AdvisoryLockBusyError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name that was already held.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockBusyError"
    this.lockName = name
  }
}

/**
 * Thrown when a callback holds an advisory lock longer than `holdTimeoutMs`.
 */
class AdvisoryLockHoldTimeoutError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {{name: string}} args - The advisory lock name whose hold timed out.
   */
  constructor(message, {name}) {
    super(message)
    this.name = "AdvisoryLockHoldTimeoutError"
    this.lockName = name
  }
}

/**
 * Runs advisory locks on the caller connection by default, using a dedicated
 * lock connection only when a positive hold timeout needs separate ownership.
 */
export default class AdvisoryLockRunner {
  /**
   * Creates an advisory-lock runner for one model database identifier.
   * @param {{configuration: import("../configuration.js").default, connectionProvider: () => import("./drivers/base.js").default, databaseIdentifier: string}} args - Runner dependencies.
   */
  constructor({configuration, connectionProvider, databaseIdentifier}) {
    this.configuration = configuration
    this.connectionProvider = connectionProvider
    this.databaseIdentifier = databaseIdentifier
  }

  /**
   * Runs a callback after acquiring the advisory lock, waiting up to `timeoutMs`.
   * When a `holdTimeoutMs` is set the callback receives a `TimeoutControl` from
   * awaitery for cooperative cancellation (`control.check()`, `control.signal`,
   * `control.timedOut`, `control.remaining()`).
   * @template T
   * @param {string} name - Lock name.
   * @param {(control?: import("awaitery/build/timeout.js").TimeoutControl) => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null}} [args] - Lock and hold timeout options.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withAdvisoryLock(name, callback, args = {}) {
    return await this.withLockConnection(args.holdTimeoutMs, async (connection) => {
      const acquired = await connection.acquireAdvisoryLock(name, args)

      if (!acquired) {
        throw new AdvisoryLockTimeoutError(`Timed out waiting for advisory lock ${JSON.stringify(name)}`, {name})
      }

      return await this.runLockedCallback({callback, connection, holdTimeoutMs: args.holdTimeoutMs, name})
    })
  }

  /**
   * Runs a callback only if the advisory lock can be acquired immediately.
   * When a `holdTimeoutMs` is set the callback receives a `TimeoutControl` from
   * awaitery for cooperative cancellation.
   * @template T
   * @param {string} name - Lock name.
   * @param {(control?: import("awaitery/build/timeout.js").TimeoutControl) => Promise<T>} callback - Callback to invoke while the lock is held.
   * @param {{holdTimeoutMs?: number | null}} [args] - Hold timeout options.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withAdvisoryLockOrFail(name, callback, args = {}) {
    return await this.withLockConnection(args.holdTimeoutMs, async (connection) => {
      const acquired = await connection.tryAcquireAdvisoryLock(name)

      if (!acquired) {
        throw new AdvisoryLockBusyError(`Advisory lock ${JSON.stringify(name)} is already held`, {name})
      }

      return await this.runLockedCallback({callback, connection, holdTimeoutMs: args.holdTimeoutMs, name})
    })
  }

  /**
   * Runs the lock holder callback and releases the lock from its owning connection.
   * @template T
   * @param {{callback: (control?: import("awaitery/build/timeout.js").TimeoutControl) => Promise<T>, connection: import("./drivers/base.js").default, holdTimeoutMs?: number | null, name: string}} args - Locked callback args.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async runLockedCallback({callback, connection, holdTimeoutMs, name}) {
    try {
      return await AdvisoryLockRunner.runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs)
    } finally {
      await connection.releaseAdvisoryLock(name)
    }
  }

  /**
   * Runs lock work on the caller connection unless a positive hold timeout needs
   * its own lock connection.
   * @template T
   * @param {number | null | undefined} holdTimeoutMs - Max hold time; positive values use a dedicated lock connection.
   * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback receiving the connection that owns the advisory lock.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withLockConnection(holdTimeoutMs, callback) {
    if (holdTimeoutMs && holdTimeoutMs > 0) {
      return await this.withDedicatedConnection(callback)
    }

    return await callback(this.connectionProvider())
  }

  /**
   * Spawns a hold-timeout lock connection and closes it after lock work completes when
   * the spawned driver owns the underlying physical connection.
   * @template T
   * @param {(connection: import("./drivers/base.js").default) => Promise<T>} callback - Callback that receives the dedicated lock connection.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withDedicatedConnection(callback) {
    const connection = await this.configuration.getDatabasePool(this.databaseIdentifier).spawnConnection()

    try {
      return await callback(connection)
    } finally {
      if (connection.getArgs().getConnection) {
        await connection.releaseHeldAdvisoryLocks()
      } else {
        await connection.close()
      }
    }
  }

  /**
   * Runs `callback`, rejecting with `AdvisoryLockHoldTimeoutError` if it has
   * not settled within `holdTimeoutMs`. The callback is not cancelled; callers
   * use a dedicated advisory-lock connection so the lock can still be released.
   *
   * The callback receives a `TimeoutControl` from awaitery, enabling cooperative
   * cancellation via `control.check()`, `control.signal`, `control.timedOut`,
   * and `control.remaining()`.
   * @template T
   * @param {string} name - Lock name (for the error message).
   * @param {(control?: import("awaitery/build/timeout.js").TimeoutControl) => Promise<T>} callback - Callback holding the lock.
   * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  static async runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs) {
    if (!holdTimeoutMs || holdTimeoutMs <= 0) {
      return await callback()
    }

    let callbackSettled = false

    try {
      return await timeout({timeout: holdTimeoutMs}, async (control) => {
        try {
          return await callback(control)
        } finally {
          callbackSettled = true
        }
      })
    } catch (error) {
      if (!callbackSettled) {
        throw new AdvisoryLockHoldTimeoutError(`Advisory lock ${JSON.stringify(name)} held longer than ${holdTimeoutMs}ms`, {name})
      }

      throw error
    }
  }
}

export {AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError}
