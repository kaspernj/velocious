// @ts-check

/** Internal control flow raised by `VelociousJob#rescheduleIn`. */
export default class BackgroundJobRescheduleSignal extends Error {
  /** @param {number} delayMs - Reschedule delay in milliseconds. */
  constructor(delayMs) {
    super(`Reschedule background job in ${delayMs}ms`)
    this.name = "BackgroundJobRescheduleSignal"
    this.delayMs = delayMs
  }
}
