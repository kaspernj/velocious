// @ts-check

import EventEmitter from "../../utils/event-emitter.js"

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
    super()

    /** @type {number} - Monotonic invocation counter for correlation ids. */
    this._invocationCounter = 0
  }

  /**
   * Allocates the next per-invocation correlation id.
   * @returns {string} - A unique-per-registry correlation id.
   */
  nextInvocationId() {
    this._invocationCounter += 1

    return `factory-invocation-${this._invocationCounter}`
  }
}
