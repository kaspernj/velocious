/**
 * @typedef {object} DeliveryTask
 * @property {number} byteLength - Retained complete-buffer bytes.
 * @property {boolean} countedFrame - Whether this task is an outbound frame.
 * @property {() => Promise<void>} delivery - Delivery operation.
 * @property {(error?: Error) => void} settle - Settles the enqueue promise.
 */
export type DeliveryTask = {
    /**
     * - Retained complete-buffer bytes.
     */
    byteLength: number;
    /**
     * - Whether this task is an outbound frame.
     */
    countedFrame: boolean;
    /**
     * - Delivery operation.
     */
    delivery: () => Promise<void>;
    /**
     * - Settles the enqueue promise.
     */
    settle: (error?: Error) => void;
};
export declare class ClientDeliveryQueueOverflowError extends Error {
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
    constructor({ clientCount, maxBytes, maxFrames, pendingBytes, pendingFrames, rejectedBytes }: {
        clientCount: number;
        maxBytes: number;
        maxFrames: number;
        pendingBytes: number;
        pendingFrames: number;
        rejectedBytes: number;
    });
}
export default class ClientDeliveryQueue {
    clientCount: number;
    maxBytes: number;
    maxFrames: number;
    onOverflow: (error: ClientDeliveryQueueOverflowError) => void;
    /** @type {DeliveryTask[]} */
    tasks: DeliveryTask[];
    /** @type {DeliveryTask | undefined} */
    activeTask: DeliveryTask | undefined;
    pendingBytes: number;
    pendingFrames: number;
    destroyed: boolean;
    /**
     * Builds a per-client delivery queue.
     * @param {object} args - Queue options.
     * @param {number} args.clientCount - Client identifier.
     * @param {number} args.maxBytes - Byte high-water mark.
     * @param {number} args.maxFrames - Frame high-water mark.
     * @param {(error: ClientDeliveryQueueOverflowError) => void} args.onOverflow - Overflow handler.
     */
    constructor({ clientCount, maxBytes, maxFrames, onOverflow }: {
        clientCount: number;
        maxBytes: number;
        maxFrames: number;
        onOverflow: (error: ClientDeliveryQueueOverflowError) => void;
    });
    /**
     * Enqueues one complete output buffer.
     * @param {object} args - Delivery details.
     * @param {number} args.byteLength - Exact buffer byte length.
     * @param {() => Promise<void>} args.delivery - Delivery operation.
     * @returns {Promise<void>} - Settles after delivery or teardown.
     */
    enqueueFrame({ byteLength, delivery }: {
        byteLength: number;
        delivery: () => Promise<void>;
    }): Promise<void>;
    /**
     * Enqueues an ordering-only operation that retains no complete output frame.
     * @param {() => Promise<void>} delivery - Delivery operation.
     * @returns {Promise<void>} - Settles after delivery or teardown.
     */
    enqueueControl(delivery: () => Promise<void>): Promise<void>;
    /**
     * Releases queued and active accounting during explicit client teardown.
     * @returns {void}
     */
    destroy(): void;
    /**
     * Gets current retained-buffer accounting.
     * @returns {{pendingBytes: number, pendingFrames: number}} - Current retained-buffer accounting.
     */
    snapshot(): {
        pendingBytes: number;
        pendingFrames: number;
    };
    /**
     * Enqueues a delivery task.
     * @param {Omit<DeliveryTask, "settle">} task - Task to enqueue.
     * @returns {Promise<void>} - Task completion.
     */
    _enqueue(task: Omit<DeliveryTask, "settle">): Promise<void>;
    /**
     * Starts the next task when idle.
     * @returns {void} - No return value.
     */
    _drain(): void;
    /**
     * Finishes the active delivery task.
     * @param {DeliveryTask} task - Completed task.
     * @param {Error} [error] - Delivery error.
     * @returns {void}
     */
    _finish(task: DeliveryTask, error?: Error): void;
}
//# sourceMappingURL=client-delivery-queue.d.ts.map