// @ts-check

/**
 * Serializes async callbacks through a promise chain so at most one runs at a
 * time — an in-memory mutex without a shared lock name. Concurrent `run()`
 * calls queue and execute strictly in call order; a rejected callback settles
 * the chain without blocking the callbacks queued behind it.
 *
 * Used to serialize native SQLite queries: `expo-sqlite`'s `getAllAsync`
 * prepares, executes, and finalizes a shared `NativeStatement`, and running
 * two of them concurrently on one connection races that native object
 * ("shared object already released" / "cannot be cast to NativeStatement").
 */
export default class VelociousUtilsSerialAsyncQueue {
  /**
   * Tail of the promise chain that later callbacks wait on.
   * @type {Promise<unknown>}
   */
  _tail = Promise.resolve()

  /**
   * Runs the callback once every previously-queued callback has settled.
   * @template T
   * @param {() => Promise<T> | T} callback - Work to run exclusively.
   * @returns {Promise<T>} - Resolves or rejects with the callback's result.
   */
  run(callback) {
    const result = this._tail.then(() => callback(), () => callback())

    // Keep the chain alive regardless of this callback's outcome so a
    // rejection doesn't reject every future run() and stall the queue.
    this._tail = result.then(() => {}, () => {})

    return result
  }
}
