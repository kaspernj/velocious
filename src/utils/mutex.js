// @ts-check

export default class Mutex {
  constructor() {
    this._locked = false
    this._queue = []
  }

  /**
   * Run a callback with exclusive access.
   * @template T
   * @param {() => (T | Promise<T>)} callback - Work to run.
   * @returns {Promise<T>} - Resolves with callback result.
   */
  async sync(callback) {
    if (!this._locked) {
      this._locked = true
      try {
        return await callback()
      } finally {
        await this._runNext()
      }
    }

    return await new Promise((resolve, reject) => {
      this._queue.push({callback, resolve, reject})
    })
  }

  /**
   * @returns {Promise<void>} - Resolves when queue is processed.
   */
  async _runNext() {
    const next = this._queue.shift()

    if (!next) {
      this._locked = false
      return
    }

    try {
      const result = await next.callback()
      next.resolve(result)
    } catch (error) {
      next.reject(error)
    } finally {
      await this._runNext()
    }
  }
}
