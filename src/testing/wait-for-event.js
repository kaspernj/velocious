// @ts-check

/**
 * @typedef {object} WaitForEventOptions
 * @property {number} [timeoutMs] Timeout in milliseconds (default: 5000).
 * @property {(...args: Array<?>) => boolean} [filter] Only resolve when this predicate returns true for the emitted arguments.
 */

/**
 * @typedef {object} EventEmitterLike
 * @property {(event: string, listener: (...args: Array<?>) => void) => void} on Registers a listener.
 * @property {(event: string, listener: (...args: Array<?>) => void) => void} off Removes a listener.
 */

/**
 * Resolves the moment `eventName` fires on `emitter` — optionally only when `filter`
 * matches the emitted arguments — instead of sleeping a fixed duration. Rejects with a
 * timeout error if the event does not fire within `timeoutMs`. The listener is always
 * removed (on resolve and on timeout).
 *
 * Use this to await a real signal (a background job finishing, a model update, a
 * websocket message) rather than guessing a delay. To poll an arbitrary condition
 * instead of a discrete event, use awaitery's `waitFor`.
 * @param {EventEmitterLike} emitter - Event emitter exposing `on`/`off` (Node EventEmitter, eventemitter3, velocious `testEvents`, ...).
 * @param {string} eventName - The event to wait for.
 * @param {WaitForEventOptions} [options] - Options.
 * @returns {Promise<?>} - Resolves with the single emitted argument, an array when the event emits multiple, or undefined when it emits none.
 */
export default function waitForEvent(emitter, eventName, options = {}) {
  const {timeoutMs = 5000, filter} = options

  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout>} */
    let timer

    /**
     * Resolves the wait when a matching event fires, removing itself first. A filter
     * that throws (e.g. it assumes an event shape an intermediate emission doesn't
     * have) rejects immediately rather than leaving the waiter pending until timeout.
     * @param {...?} args - Emitted arguments.
     * @returns {void}
     */
    const listener = (...args) => {
      if (filter) {
        let matched

        try {
          matched = filter(...args)
        } catch (error) {
          clearTimeout(timer)
          emitter.off(eventName, listener)
          reject(error)

          return
        }

        if (!matched) return
      }

      clearTimeout(timer)
      emitter.off(eventName, listener)
      resolve(args.length > 1 ? args : args[0])
    }

    timer = setTimeout(() => {
      emitter.off(eventName, listener)
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for event ${JSON.stringify(eventName)}`))
    }, timeoutMs)

    emitter.on(eventName, listener)
  })
}
