// @ts-check
import EventEmitter from "../../utils/event-emitter.js";
/**
 * A small factory event emitter used for debug/performance hooks. It emits
 * `start`, `success` and `failure` events carrying the factory name, strategy,
 * requested traits, a per-invocation correlation id and (on completion) a
 * duration. It deliberately never emits resolved attribute values, which may
 * contain secrets.
 */
export default class FactoryEventEmitter extends EventEmitter {
    /** Builds the emitter. */
    constructor() {
        super();
        /** @type {number} - Monotonic invocation counter for correlation ids. */
        this._invocationCounter = 0;
    }
    /**
     * Allocates the next per-invocation correlation id.
     * @returns {string} - A unique-per-registry correlation id.
     */
    nextInvocationId() {
        this._invocationCounter += 1;
        return `factory-invocation-${this._invocationCounter}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZlbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZmFjdG9yeS9ldmVudHMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBRXZEOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUJBQW9CLFNBQVEsWUFBWTtJQUMzRCwwQkFBMEI7SUFDMUI7UUFDRSxLQUFLLEVBQUUsQ0FBQTtRQUVQLHlFQUF5RTtRQUN6RSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxnQkFBZ0I7UUFDZCxJQUFJLENBQUMsa0JBQWtCLElBQUksQ0FBQyxDQUFBO1FBRTVCLE9BQU8sc0JBQXNCLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO0lBQ3hELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi8uLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcblxuLyoqXG4gKiBBIHNtYWxsIGZhY3RvcnkgZXZlbnQgZW1pdHRlciB1c2VkIGZvciBkZWJ1Zy9wZXJmb3JtYW5jZSBob29rcy4gSXQgZW1pdHNcbiAqIGBzdGFydGAsIGBzdWNjZXNzYCBhbmQgYGZhaWx1cmVgIGV2ZW50cyBjYXJyeWluZyB0aGUgZmFjdG9yeSBuYW1lLCBzdHJhdGVneSxcbiAqIHJlcXVlc3RlZCB0cmFpdHMsIGEgcGVyLWludm9jYXRpb24gY29ycmVsYXRpb24gaWQgYW5kIChvbiBjb21wbGV0aW9uKSBhXG4gKiBkdXJhdGlvbi4gSXQgZGVsaWJlcmF0ZWx5IG5ldmVyIGVtaXRzIHJlc29sdmVkIGF0dHJpYnV0ZSB2YWx1ZXMsIHdoaWNoIG1heVxuICogY29udGFpbiBzZWNyZXRzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGYWN0b3J5RXZlbnRFbWl0dGVyIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgLyoqIEJ1aWxkcyB0aGUgZW1pdHRlci4gKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKVxuXG4gICAgLyoqIEB0eXBlIHtudW1iZXJ9IC0gTW9ub3RvbmljIGludm9jYXRpb24gY291bnRlciBmb3IgY29ycmVsYXRpb24gaWRzLiAqL1xuICAgIHRoaXMuX2ludm9jYXRpb25Db3VudGVyID0gMFxuICB9XG5cbiAgLyoqXG4gICAqIEFsbG9jYXRlcyB0aGUgbmV4dCBwZXItaW52b2NhdGlvbiBjb3JyZWxhdGlvbiBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBIHVuaXF1ZS1wZXItcmVnaXN0cnkgY29ycmVsYXRpb24gaWQuXG4gICAqL1xuICBuZXh0SW52b2NhdGlvbklkKCkge1xuICAgIHRoaXMuX2ludm9jYXRpb25Db3VudGVyICs9IDFcblxuICAgIHJldHVybiBgZmFjdG9yeS1pbnZvY2F0aW9uLSR7dGhpcy5faW52b2NhdGlvbkNvdW50ZXJ9YFxuICB9XG59XG4iXX0=