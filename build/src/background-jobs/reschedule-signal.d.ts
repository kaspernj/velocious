/** Internal control flow raised by `VelociousJob#rescheduleIn`. */
export default class BackgroundJobRescheduleSignal extends Error {
    delayMs: number;
    /**
     * Creates a reschedule control signal.
     * @param {number} delayMs - Reschedule delay in milliseconds.
     */
    constructor(delayMs: number);
}
//# sourceMappingURL=reschedule-signal.d.ts.map