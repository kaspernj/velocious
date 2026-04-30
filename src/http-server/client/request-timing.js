// @ts-check

/**
 * @typedef {"controller" | "db" | "views"} RequestTimingBucket
 */

/**
 * @typedef {{bucket: RequestTimingBucket, startedAtMs: number}} ActiveTimingBucket
 */

/**
 * Tracks exclusive request timing buckets. When a nested bucket starts,
 * the currently active bucket is paused until the nested bucket exits.
 */
export default class RequestTiming {
  /** @type {Record<RequestTimingBucket, number>} */
  buckets = {
    controller: 0,
    db: 0,
    views: 0
  }

  /** @type {ActiveTimingBucket[]} */
  bucketStack = []

  dbQueryCount = 0
  /** @type {"debug" | "info" | undefined} */
  completedLogMethod = undefined
  /** @type {string | undefined} */
  completedLogSubject = undefined
  /** @type {number | undefined} */
  responseServedAtMs = undefined
  startedAtMs = Date.now()

  /**
   * @template T
   * @param {RequestTimingBucket} bucket - Bucket name.
   * @param {() => Promise<T> | T} callback - Callback to measure.
   * @returns {Promise<T>} - Callback result.
   */
  async measure(bucket, callback) {
    this._pushBucket(bucket)

    try {
      return await callback()
    } finally {
      this._popBucket()
    }
  }

  /**
   * @template T
   * @param {RequestTimingBucket} bucket - Bucket name.
   * @param {() => T} callback - Callback to measure.
   * @returns {T} - Callback result.
   */
  measureSync(bucket, callback) {
    this._pushBucket(bucket)

    try {
      return callback()
    } finally {
      this._popBucket()
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} callback - Query callback.
   * @returns {Promise<T>} - Query result.
   */
  async measureDbQuery(callback) {
    this.dbQueryCount += 1

    return await this.measure("db", callback)
  }

  /** @returns {void} - Marks the response as fully served. */
  markResponseServed() {
    this.responseServedAtMs = Date.now()
  }

  /**
   * @returns {{controllerMs: number, dbMs: number, totalMs: number, velociousMs: number, viewsMs: number, dbQueryCount: number}} - Timing summary.
   */
  summary() {
    const now = this.responseServedAtMs || Date.now()
    const buckets = this._bucketTotalsAt(now)
    const totalMs = now - this.startedAtMs
    const controllerMs = buckets.controller
    const dbMs = buckets.db
    const viewsMs = buckets.views
    const velociousMs = Math.max(totalMs - controllerMs - dbMs - viewsMs, 0)

    return {
      controllerMs,
      dbMs,
      dbQueryCount: this.dbQueryCount,
      totalMs,
      velociousMs,
      viewsMs
    }
  }

  /**
   * @param {number} now - Timestamp to calculate active bucket elapsed time against.
   * @returns {Record<RequestTimingBucket, number>} - Bucket totals.
   */
  _bucketTotalsAt(now) {
    const buckets = Object.assign({}, this.buckets)
    const activeBucket = this.bucketStack[this.bucketStack.length - 1]

    if (activeBucket) {
      buckets[activeBucket.bucket] += Math.max(now - activeBucket.startedAtMs, 0)
    }

    return buckets
  }

  /**
   * @param {RequestTimingBucket} bucket - Bucket name.
   * @returns {void} - No return value.
   */
  _pushBucket(bucket) {
    const now = Date.now()
    const activeBucket = this.bucketStack[this.bucketStack.length - 1]

    if (activeBucket) {
      this.buckets[activeBucket.bucket] += now - activeBucket.startedAtMs
    }

    this.bucketStack.push({bucket, startedAtMs: now})
  }

  /** @returns {void} - No return value. */
  _popBucket() {
    const now = Date.now()
    const activeBucket = this.bucketStack.pop()

    if (!activeBucket) throw new Error("No active request timing bucket")

    this.buckets[activeBucket.bucket] += now - activeBucket.startedAtMs

    const parentBucket = this.bucketStack[this.bucketStack.length - 1]
    if (parentBucket) parentBucket.startedAtMs = now
  }
}
