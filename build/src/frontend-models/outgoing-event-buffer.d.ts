/**
 * BufferedOutgoingEvent type.
 * @typedef {object} BufferedOutgoingEvent
 * @property {string} customPath - Request path.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} payload - Command payload.
 */
export type BufferedOutgoingEvent = {
    /**
     * - Request path.
     */
    customPath: string;
    /**
     * - Command payload.
     */
    payload: Record<string, ReturnType<typeof JSON.parse>>;
};
/**
 * Adds an event to the outgoing buffer. Drops the oldest event when the buffer exceeds the max size.
 * @param {BufferedOutgoingEvent} event - Event to buffer.
 * @returns {void}
 */
export declare function bufferOutgoingEvent(event: BufferedOutgoingEvent): void;
/**
 * Returns and clears all buffered events in FIFO order.
 * @returns {BufferedOutgoingEvent[]} - Drained events.
 */
export declare function drainBufferedOutgoingEvents(): BufferedOutgoingEvent[];
/**
 * Runs the clearBufferedOutgoingEvents helper.
 * @returns {void} */
export declare function clearBufferedOutgoingEvents(): void;
/**
 * Runs the bufferedOutgoingEventCount helper.
 * @returns {number} - Current buffer size.
 */
export declare function bufferedOutgoingEventCount(): number;
//# sourceMappingURL=outgoing-event-buffer.d.ts.map