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
    constructor({ clientCount, maxBytes, maxFrames, pendingBytes, pendingFrames, rejectedBytes }) {
        super(`WebSocket client ${clientCount} exceeded its outbound queue limit (${pendingFrames}/${maxFrames} frames, ${pendingBytes}/${maxBytes} bytes; rejected ${rejectedBytes} bytes)`);
        this.name = "ClientDeliveryQueueOverflowError";
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
    constructor({ clientCount, maxBytes, maxFrames, onOverflow }) {
        this.clientCount = clientCount;
        this.maxBytes = maxBytes;
        this.maxFrames = maxFrames;
        this.onOverflow = onOverflow;
        /** @type {DeliveryTask[]} */
        this.tasks = [];
        /** @type {DeliveryTask | undefined} */
        this.activeTask = undefined;
        this.pendingBytes = 0;
        this.pendingFrames = 0;
        this.destroyed = false;
    }
    /**
     * Enqueues one complete output buffer.
     * @param {object} args - Delivery details.
     * @param {number} args.byteLength - Exact buffer byte length.
     * @param {() => Promise<void>} args.delivery - Delivery operation.
     * @returns {Promise<void>} - Settles after delivery or teardown.
     */
    enqueueFrame({ byteLength, delivery }) {
        if (this.destroyed)
            return Promise.resolve();
        if (this.pendingFrames + 1 > this.maxFrames || this.pendingBytes + byteLength > this.maxBytes) {
            const error = new ClientDeliveryQueueOverflowError({
                clientCount: this.clientCount,
                maxBytes: this.maxBytes,
                maxFrames: this.maxFrames,
                pendingBytes: this.pendingBytes,
                pendingFrames: this.pendingFrames,
                rejectedBytes: byteLength
            });
            this.onOverflow(error);
            return Promise.reject(error);
        }
        this.pendingFrames += 1;
        this.pendingBytes += byteLength;
        return this._enqueue({ byteLength, countedFrame: true, delivery });
    }
    /**
     * Enqueues an ordering-only operation that retains no complete output frame.
     * @param {() => Promise<void>} delivery - Delivery operation.
     * @returns {Promise<void>} - Settles after delivery or teardown.
     */
    enqueueControl(delivery) {
        if (this.destroyed)
            return Promise.resolve();
        return this._enqueue({ byteLength: 0, countedFrame: false, delivery });
    }
    /**
     * Releases queued and active accounting during explicit client teardown.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        const tasks = this.activeTask ? [this.activeTask, ...this.tasks] : this.tasks;
        this.activeTask = undefined;
        this.tasks = [];
        this.pendingBytes = 0;
        this.pendingFrames = 0;
        for (const task of tasks)
            task.settle();
    }
    /**
     * Gets current retained-buffer accounting.
     * @returns {{pendingBytes: number, pendingFrames: number}} - Current retained-buffer accounting.
     */
    snapshot() {
        return { pendingBytes: this.pendingBytes, pendingFrames: this.pendingFrames };
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
            });
        });
        this._drain();
        return promise;
    }
    /**
     * Starts the next task when idle.
     * @returns {void} - No return value.
     */
    _drain() {
        if (this.destroyed || this.activeTask)
            return;
        const task = this.tasks.shift();
        if (!task)
            return;
        this.activeTask = task;
        void task.delivery().then(() => this._finish(task), (error) => this._finish(task, error));
    }
    /**
     * Finishes the active delivery task.
     * @param {DeliveryTask} task - Completed task.
     * @param {Error} [error] - Delivery error.
     * @returns {void}
     */
    _finish(task, error) {
        if (this.destroyed || this.activeTask !== task)
            return;
        this.activeTask = undefined;
        if (task.countedFrame) {
            this.pendingBytes -= task.byteLength;
            this.pendingFrames -= 1;
        }
        task.settle(error);
        this._drain();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LWRlbGl2ZXJ5LXF1ZXVlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2h0dHAtc2VydmVyL2NsaWVudC1kZWxpdmVyeS1xdWV1ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7O0dBTUc7QUFDSCxZQUFZO0FBRVosTUFBTSxPQUFPLGdDQUFpQyxTQUFRLEtBQUs7SUFDekQ7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLFlBQVksRUFBRSxhQUFhLEVBQUUsYUFBYSxFQUFDO1FBQ3hGLEtBQUssQ0FBQyxvQkFBb0IsV0FBVyx1Q0FBdUMsYUFBYSxJQUFJLFNBQVMsWUFBWSxZQUFZLElBQUksUUFBUSxvQkFBb0IsYUFBYSxTQUFTLENBQUMsQ0FBQTtRQUNyTCxJQUFJLENBQUMsSUFBSSxHQUFHLGtDQUFrQyxDQUFBO0lBQ2hELENBQUM7Q0FDRjtBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUJBQW1CO0lBQ3RDOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFDO1FBQ3hELElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQzlCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsS0FBSyxHQUFHLEVBQUUsQ0FBQTtRQUNmLHVDQUF1QztRQUN2QyxJQUFJLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtRQUMzQixJQUFJLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQTtRQUNyQixJQUFJLENBQUMsYUFBYSxHQUFHLENBQUMsQ0FBQTtRQUN0QixJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUss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QUFDLENBQUE7UUFFRixJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7UUFDYixPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTTtRQUNKLElBQUksSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsVUFBVTtZQUFFLE9BQU07UUFFN0MsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUMvQixJQUFJLENBQUMsSUFBSTtZQUFFLE9BQU07UUFFakIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUE7UUFDdEIsS0FBSyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxDQUN2QixHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUN4QixDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQ3JDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUs7UUFDakIsSUFBSSxJQUFJLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssSUFBSTtZQUFFLE9BQU07UUFFdEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0IsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdEIsSUFBSSxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFBO1lBQ3BDLElBQUksQ0FBQyxhQUFhLElBQUksQ0FBQyxDQUFBO1FBQ3pCLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ2xCLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUNmLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gRGVsaXZlcnlUYXNrXG4gKiBAcHJvcGVydHkge251bWJlcn0gYnl0ZUxlbmd0aCAtIFJldGFpbmVkIGNvbXBsZXRlLWJ1ZmZlciBieXRlcy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY291bnRlZEZyYW1lIC0gV2hldGhlciB0aGlzIHRhc2sgaXMgYW4gb3V0Ym91bmQgZnJhbWUuXG4gKiBAcHJvcGVydHkgeygpID0+IFByb21pc2U8dm9pZD59IGRlbGl2ZXJ5IC0gRGVsaXZlcnkgb3BlcmF0aW9uLlxuICogQHByb3BlcnR5IHsoZXJyb3I/OiBFcnJvcikgPT4gdm9pZH0gc2V0dGxlIC0gU2V0dGxlcyB0aGUgZW5xdWV1ZSBwcm9taXNlLlxuICovXG4vLyBAdHMtY2hlY2tcblxuZXhwb3J0IGNsYXNzIENsaWVudERlbGl2ZXJ5UXVldWVPdmVyZmxvd0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogQnVpbGRzIGFuIG91dGJvdW5kIHF1ZXVlIG92ZXJmbG93IGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE92ZXJmbG93IGRldGFpbHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNsaWVudENvdW50IC0gQ2xpZW50IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm1heEJ5dGVzIC0gQ29uZmlndXJlZCBieXRlIGhpZ2gtd2F0ZXIgbWFyay5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4RnJhbWVzIC0gQ29uZmlndXJlZCBmcmFtZSBoaWdoLXdhdGVyIG1hcmsuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnBlbmRpbmdCeXRlcyAtIEJ5dGVzIHJldGFpbmVkIGJlZm9yZSByZWplY3RpbmcgdGhlIGZyYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5wZW5kaW5nRnJhbWVzIC0gRnJhbWVzIHJldGFpbmVkIGJlZm9yZSByZWplY3RpbmcgdGhlIGZyYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWplY3RlZEJ5dGVzIC0gUmVqZWN0ZWQgZnJhbWUgc2l6ZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjbGllbnRDb3VudCwgbWF4Qnl0ZXMsIG1heEZyYW1lcywgcGVuZGluZ0J5dGVzLCBwZW5kaW5nRnJhbWVzLCByZWplY3RlZEJ5dGVzfSkge1xuICAgIHN1cGVyKGBXZWJTb2NrZXQgY2xpZW50ICR7Y2xpZW50Q291bnR9IGV4Y2VlZGVkIGl0cyBvdXRib3VuZCBxdWV1ZSBsaW1pdCAoJHtwZW5kaW5nRnJhbWVzfS8ke21heEZyYW1lc30gZnJhbWVzLCAke3BlbmRpbmdCeXRlc30vJHttYXhCeXRlc30gYnl0ZXM7IHJlamVjdGVkICR7cmVqZWN0ZWRCeXRlc30gYnl0ZXMpYClcbiAgICB0aGlzLm5hbWUgPSBcIkNsaWVudERlbGl2ZXJ5UXVldWVPdmVyZmxvd0Vycm9yXCJcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBDbGllbnREZWxpdmVyeVF1ZXVlIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHBlci1jbGllbnQgZGVsaXZlcnkgcXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY2xpZW50Q291bnQgLSBDbGllbnQgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgLSBCeXRlIGhpZ2gtd2F0ZXIgbWFyay5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4RnJhbWVzIC0gRnJhbWUgaGlnaC13YXRlciBtYXJrLlxuICAgKiBAcGFyYW0geyhlcnJvcjogQ2xpZW50RGVsaXZlcnlRdWV1ZU92ZXJmbG93RXJyb3IpID0+IHZvaWR9IGFyZ3Mub25PdmVyZmxvdyAtIE92ZXJmbG93IGhhbmRsZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y2xpZW50Q291bnQsIG1heEJ5dGVzLCBtYXhGcmFtZXMsIG9uT3ZlcmZsb3d9KSB7XG4gICAgdGhpcy5jbGllbnRDb3VudCA9IGNsaWVudENvdW50XG4gICAgdGhpcy5tYXhCeXRlcyA9IG1heEJ5dGVzXG4gICAgdGhpcy5tYXhGcmFtZXMgPSBtYXhGcmFtZXNcbiAgICB0aGlzLm9uT3ZlcmZsb3cgPSBvbk92ZXJmbG93XG4gICAgLyoqIEB0eXBlIHtEZWxpdmVyeVRhc2tbXX0gKi9cbiAgICB0aGlzLnRhc2tzID0gW11cbiAgICAvKiogQHR5cGUge0RlbGl2ZXJ5VGFzayB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmFjdGl2ZVRhc2sgPSB1bmRlZmluZWRcbiAgICB0aGlzLnBlbmRpbmdCeXRlcyA9IDBcbiAgICB0aGlzLnBlbmRpbmdGcmFtZXMgPSAwXG4gICAgdGhpcy5kZXN0cm95ZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEVucXVldWVzIG9uZSBjb21wbGV0ZSBvdXRwdXQgYnVmZmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERlbGl2ZXJ5IGRldGFpbHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJ5dGVMZW5ndGggLSBFeGFjdCBidWZmZXIgYnl0ZSBsZW5ndGguXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5kZWxpdmVyeSAtIERlbGl2ZXJ5IG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2V0dGxlcyBhZnRlciBkZWxpdmVyeSBvciB0ZWFyZG93bi5cbiAgICovXG4gIGVucXVldWVGcmFtZSh7Ynl0ZUxlbmd0aCwgZGVsaXZlcnl9KSB7XG4gICAgaWYgKHRoaXMuZGVzdHJveWVkKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcblxuICAgIGlmICh0aGlzLnBlbmRpbmdGcmFtZXMgKyAxID4gdGhpcy5tYXhGcmFtZXMgfHwgdGhpcy5wZW5kaW5nQnl0ZXMgKyBieXRlTGVuZ3RoID4gdGhpcy5tYXhCeXRlcykge1xuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgQ2xpZW50RGVsaXZlcnlRdWV1ZU92ZXJmbG93RXJyb3Ioe1xuICAgICAgICBjbGllbnRDb3VudDogdGhpcy5jbGllbnRDb3VudCxcbiAgICAgICAgbWF4Qnl0ZXM6IHRoaXMubWF4Qnl0ZXMsXG4gICAgICAgIG1heEZyYW1lczogdGhpcy5tYXhGcmFtZXMsXG4gICAgICAgIHBlbmRpbmdCeXRlczogdGhpcy5wZW5kaW5nQnl0ZXMsXG4gICAgICAgIHBlbmRpbmdGcmFtZXM6IHRoaXMucGVuZGluZ0ZyYW1lcyxcbiAgICAgICAgcmVqZWN0ZWRCeXRlczogYnl0ZUxlbmd0aFxuICAgICAgfSlcblxuICAgICAgdGhpcy5vbk92ZXJmbG93KGVycm9yKVxuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycm9yKVxuICAgIH1cblxuICAgIHRoaXMucGVuZGluZ0ZyYW1lcyArPSAxXG4gICAgdGhpcy5wZW5kaW5nQnl0ZXMgKz0gYnl0ZUxlbmd0aFxuICAgIHJldHVybiB0aGlzLl9lbnF1ZXVlKHtieXRlTGVuZ3RoLCBjb3VudGVkRnJhbWU6IHRydWUsIGRlbGl2ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBhbiBvcmRlcmluZy1vbmx5IG9wZXJhdGlvbiB0aGF0IHJldGFpbnMgbm8gY29tcGxldGUgb3V0cHV0IGZyYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGRlbGl2ZXJ5IC0gRGVsaXZlcnkgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTZXR0bGVzIGFmdGVyIGRlbGl2ZXJ5IG9yIHRlYXJkb3duLlxuICAgKi9cbiAgZW5xdWV1ZUNvbnRyb2woZGVsaXZlcnkpIHtcbiAgICBpZiAodGhpcy5kZXN0cm95ZWQpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2VucXVldWUoe2J5dGVMZW5ndGg6IDAsIGNvdW50ZWRGcmFtZTogZmFsc2UsIGRlbGl2ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBxdWV1ZWQgYW5kIGFjdGl2ZSBhY2NvdW50aW5nIGR1cmluZyBleHBsaWNpdCBjbGllbnQgdGVhcmRvd24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZGVzdHJveSgpIHtcbiAgICBpZiAodGhpcy5kZXN0cm95ZWQpIHJldHVyblxuXG4gICAgdGhpcy5kZXN0cm95ZWQgPSB0cnVlXG4gICAgY29uc3QgdGFza3MgPSB0aGlzLmFjdGl2ZVRhc2sgPyBbdGhpcy5hY3RpdmVUYXNrLCAuLi50aGlzLnRhc2tzXSA6IHRoaXMudGFza3NcblxuICAgIHRoaXMuYWN0aXZlVGFzayA9IHVuZGVmaW5lZFxuICAgIHRoaXMudGFza3MgPSBbXVxuICAgIHRoaXMucGVuZGluZ0J5dGVzID0gMFxuICAgIHRoaXMucGVuZGluZ0ZyYW1lcyA9IDBcblxuICAgIGZvciAoY29uc3QgdGFzayBvZiB0YXNrcykgdGFzay5zZXR0bGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgY3VycmVudCByZXRhaW5lZC1idWZmZXIgYWNjb3VudGluZy5cbiAgICogQHJldHVybnMge3twZW5kaW5nQnl0ZXM6IG51bWJlciwgcGVuZGluZ0ZyYW1lczogbnVtYmVyfX0gLSBDdXJyZW50IHJldGFpbmVkLWJ1ZmZlciBhY2NvdW50aW5nLlxuICAgKi9cbiAgc25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHtwZW5kaW5nQnl0ZXM6IHRoaXMucGVuZGluZ0J5dGVzLCBwZW5kaW5nRnJhbWVzOiB0aGlzLnBlbmRpbmdGcmFtZXN9XG4gIH1cblxuICAvKipcbiAgICogRW5xdWV1ZXMgYSBkZWxpdmVyeSB0YXNrLlxuICAgKiBAcGFyYW0ge09taXQ8RGVsaXZlcnlUYXNrLCBcInNldHRsZVwiPn0gdGFzayAtIFRhc2sgdG8gZW5xdWV1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gVGFzayBjb21wbGV0aW9uLlxuICAgKi9cbiAgX2VucXVldWUodGFzaykge1xuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLnRhc2tzLnB1c2goe1xuICAgICAgICAuLi50YXNrLFxuICAgICAgICBzZXR0bGU6IChlcnJvcikgPT4gZXJyb3IgPyByZWplY3QoZXJyb3IpIDogcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICB0aGlzLl9kcmFpbigpXG4gICAgcmV0dXJuIHByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgdGhlIG5leHQgdGFzayB3aGVuIGlkbGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9kcmFpbigpIHtcbiAgICBpZiAodGhpcy5kZXN0cm95ZWQgfHwgdGhpcy5hY3RpdmVUYXNrKSByZXR1cm5cblxuICAgIGNvbnN0IHRhc2sgPSB0aGlzLnRhc2tzLnNoaWZ0KClcbiAgICBpZiAoIXRhc2spIHJldHVyblxuXG4gICAgdGhpcy5hY3RpdmVUYXNrID0gdGFza1xuICAgIHZvaWQgdGFzay5kZWxpdmVyeSgpLnRoZW4oXG4gICAgICAoKSA9PiB0aGlzLl9maW5pc2godGFzayksXG4gICAgICAoZXJyb3IpID0+IHRoaXMuX2ZpbmlzaCh0YXNrLCBlcnJvcilcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogRmluaXNoZXMgdGhlIGFjdGl2ZSBkZWxpdmVyeSB0YXNrLlxuICAgKiBAcGFyYW0ge0RlbGl2ZXJ5VGFza30gdGFzayAtIENvbXBsZXRlZCB0YXNrLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBbZXJyb3JdIC0gRGVsaXZlcnkgZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZpbmlzaCh0YXNrLCBlcnJvcikge1xuICAgIGlmICh0aGlzLmRlc3Ryb3llZCB8fCB0aGlzLmFjdGl2ZVRhc2sgIT09IHRhc2spIHJldHVyblxuXG4gICAgdGhpcy5hY3RpdmVUYXNrID0gdW5kZWZpbmVkXG4gICAgaWYgKHRhc2suY291bnRlZEZyYW1lKSB7XG4gICAgICB0aGlzLnBlbmRpbmdCeXRlcyAtPSB0YXNrLmJ5dGVMZW5ndGhcbiAgICAgIHRoaXMucGVuZGluZ0ZyYW1lcyAtPSAxXG4gICAgfVxuICAgIHRhc2suc2V0dGxlKGVycm9yKVxuICAgIHRoaXMuX2RyYWluKClcbiAgfVxufVxuIl19