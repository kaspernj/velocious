/**
 * @typedef {object} DeliveryTask
 * @property {number} byteLength - Retained complete-buffer bytes.
 * @property {boolean} countedFrame - Whether this task is an outbound frame.
 * @property {() => Promise<void>} delivery - Delivery operation.
 * @property {(error?: Error) => void} settle - Settles the enqueue promise.
 */
// @ts-check

export class ClientDeliveryQueueOverflowError extends Error {
  /**
   * Builds an outbound queue overflow error.
   * @param {object} args - Overflow details.
   * @param {number} args.clientCount - Client identifier.
   * @param {number} args.maxBytes - Configured byte high-water mark.
   * @param {number} args.maxFrames - Configured frame high-water mark.
   * @param {number} args.pendingBytes - Bytes retained before rejecting the frame.
   * @param {number} args.pendingFrames - Frames retained before rejecting the frame.
   * @param {number} args.rejectedBytes - Rejected frame size.
   */
  constructor({clientCount, maxBytes, maxFrames, pendingBytes, pendingFrames, rejectedBytes}) {
    super(`WebSocket client ${clientCount} exceeded its outbound queue limit (${pendingFrames}/${maxFrames} frames, ${pendingBytes}/${maxBytes} bytes; rejected ${rejectedBytes} bytes)`)
    this.name = "ClientDeliveryQueueOverflowError"
  }
}

export default class ClientDeliveryQueue {
  /**
   * Builds a per-client delivery queue.
   * @param {object} args - Queue options.
   * @param {number} args.clientCount - Client identifier.
   * @param {number} args.maxBytes - Byte high-water mark.
   * @param {number} args.maxFrames - Frame high-water mark.
   * @param {(error: ClientDeliveryQueueOverflowError) => void} args.onOverflow - Overflow handler.
   */
  constructor({clientCount, maxBytes, maxFrames, onOverflow}) {
    this.clientCount = clientCount
    this.maxBytes = maxBytes
    this.maxFrames = maxFrames
    this.onOverflow = onOverflow
    /** @type {DeliveryTask[]} */
    this.tasks = []
    /** @type {DeliveryTask | undefined} */
    this.activeTask = undefined
    this.pendingBytes = 0
    this.pendingFrames = 0
    this.destroyed = false
  }

  /**
   * Enqueues one complete output buffer.
   * @param {object} args - Delivery details.
   * @param {number} args.byteLength - Exact buffer byte length.
   * @param {() => Promise<void>} args.delivery - Delivery operation.
   * @returns {Promise<void>} - Settles after delivery or teardown.
   */
  enqueueFrame({byteLength, delivery}) {
    if (this.destroyed) return Promise.resolve()

    if (this.pendingFrames + 1 > this.maxFrames || this.pendingBytes + byteLength > this.maxBytes) {
      const error = new ClientDeliveryQueueOverflowError({
        clientCount: this.clientCount,
        maxBytes: this.maxBytes,
        maxFrames: this.maxFrames,
        pendingBytes: this.pendingBytes,
        pendingFrames: this.pendingFrames,
        rejectedBytes: byteLength
      })

      this.onOverflow(error)
      return Promise.reject(error)
    }

    this.pendingFrames += 1
    this.pendingBytes += byteLength
    return this._enqueue({byteLength, countedFrame: true, delivery})
  }

  /**
   * Enqueues an ordering-only operation that retains no complete output frame.
   * @param {() => Promise<void>} delivery - Delivery operation.
   * @returns {Promise<void>} - Settles after delivery or teardown.
   */
  enqueueControl(delivery) {
    if (this.destroyed) return Promise.resolve()

    return this._enqueue({byteLength: 0, countedFrame: false, delivery})
  }

  /**
   * Releases queued and active accounting during explicit client teardown.
   * @returns {void}
   */
  destroy() {
    if (this.destroyed) return

    this.destroyed = true
    const tasks = this.activeTask ? [this.activeTask, ...this.tasks] : this.tasks

    this.activeTask = undefined
    this.tasks = []
    this.pendingBytes = 0
    this.pendingFrames = 0

    for (const task of tasks) task.settle()
  }

  /**
   * Gets current retained-buffer accounting.
   * @returns {{pendingBytes: number, pendingFrames: number}} - Current retained-buffer accounting.
   */
  snapshot() {
    return {pendingBytes: this.pendingBytes, pendingFrames: this.pendingFrames}
  }

  /**
   * Enqueues a delivery task.
   * @param {Omit<DeliveryTask, "settle">} task - Task to enqueue.
   * @returns {Promise<void>} - Task completion.
   */
  _enqueue(task) {
    const promise = new Promise((resolve, reject) => {
      this.tasks.push({
        ...task,
        settle: (error) => error ? reject(error) : resolve(undefined)
      })
    })

    this._drain()
    return promise
  }

  /**
   * Starts the next task when idle.
   * @returns {void} - No return value.
   */
  _drain() {
    if (this.destroyed || this.activeTask) return

    const task = this.tasks.shift()
    if (!task) return

    this.activeTask = task
    void task.delivery().then(
      () => this._finish(task),
      (error) => this._finish(task, error)
    )
  }

  /**
   * Finishes the active delivery task.
   * @param {DeliveryTask} task - Completed task.
   * @param {Error} [error] - Delivery error.
   * @returns {void}
   */
  _finish(task, error) {
    if (this.destroyed || this.activeTask !== task) return

    this.activeTask = undefined
    if (task.countedFrame) {
      this.pendingBytes -= task.byteLength
      this.pendingFrames -= 1
    }
    task.settle(error)
    this._drain()
  }
}
