// @ts-check

const MAX_BUFFERED_OUTGOING_EVENTS = 50

/**
 * BufferedOutgoingEvent type.
 * @typedef {object} BufferedOutgoingEvent
 * @property {string} customPath - Request path.
 * @property {Record<string, ?>} payload - Command payload.
 */

/**
 * Buffer.
  @type {BufferedOutgoingEvent[]} */
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

/**
 * Runs the clearBufferedOutgoingEvents helper.
  @returns {void} */
export function clearBufferedOutgoingEvents() {
  buffer = []
}

/**
 * Runs the bufferedOutgoingEventCount helper.
 * @returns {number} - Current buffer size.
 */
export function bufferedOutgoingEventCount() {
  return buffer.length
}
