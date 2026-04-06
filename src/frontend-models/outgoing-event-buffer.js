// @ts-check

const MAX_BUFFERED_OUTGOING_EVENTS = 50

/**
 * @typedef {object} BufferedOutgoingEvent
 * @property {string} customPath - Request path.
 * @property {Record<string, any>} payload - Command payload.
 */

/** @type {BufferedOutgoingEvent[]} */
let buffer = []

/**
 * Adds an event to the outgoing buffer. Drops the oldest event when the buffer exceeds the max size.
 * @param {BufferedOutgoingEvent} event - Event to buffer.
 * @returns {void}
 */
export function bufferOutgoingEvent(event) {
  buffer.push(event)

  if (buffer.length > MAX_BUFFERED_OUTGOING_EVENTS) {
    buffer.shift()
  }
}

/**
 * Returns and clears all buffered events in FIFO order.
 * @returns {BufferedOutgoingEvent[]} - Drained events.
 */
export function drainBufferedOutgoingEvents() {
  return buffer.splice(0, buffer.length)
}

/** @returns {void} */
export function clearBufferedOutgoingEvents() {
  buffer = []
}

/** @returns {number} - Current buffer size. */
export function bufferedOutgoingEventCount() {
  return buffer.length
}
