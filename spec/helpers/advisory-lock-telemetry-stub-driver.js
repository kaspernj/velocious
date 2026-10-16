// @ts-check

import DatabaseDriver from "../../src/database/drivers/base.js"

/**
 * Stub driver for advisory-lock telemetry specs: no database, behavior driven
 * by explicit constructor-supplied options instead of runtime method overrides.
 *
 * @extends DatabaseDriver
 */
export default class AdvisoryLockTelemetryStubDriver extends DatabaseDriver {
  /**
   * Runs constructor.
   * @param {import("../../src/configuration-types.js").DatabaseConfigurationType} config - Database configuration.
   * @param {import("../../src/configuration.js").default} configuration - Configuration instance.
   * @param {{acquireOutcome?: "acquired" | "timeout", acquireDelayMs?: number, holderConnectionId?: string | null, holderLookupError?: string | null}} options - Stub behavior.
   */
  constructor(config, configuration, options = {}) {
    super(config, configuration)
    this.options = options
  }

  /**
   * Simulates one bounded acquisition.
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [_args] - Acquisition options.
   * @returns {Promise<boolean>} - The configured outcome.
   */
  async _acquireAdvisoryLock(_name, _args = {}) {
    if (this.options.acquireDelayMs) await new Promise((resolve) => setTimeout(resolve, this.options.acquireDelayMs))

    return this.options.acquireOutcome !== "timeout"
  }

  /**
   * Runs try acquire advisory lock.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Configured outcome.
   */
  async _tryAcquireAdvisoryLock(_name) {
    return this.options.acquireOutcome !== "timeout"
  }

  /**
   * Runs release advisory lock.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Always released.
   */
  async _releaseAdvisoryLock(_name) {
    return true
  }

  /**
   * Tier attribution for the stub (mirrors the driver-native tier).
   * @returns {string} - Tier name.
   */
  advisoryLockBackendTier() {
    return "driver-native"
  }

  /**
   * Simulates the tier's holder attribution at the event moment.
   * @param {string} name - Lock name.
   * @returns {Promise<string | null>} - Configured holder identity.
   */
  async advisoryLockHolderConnectionId(_name) {
    if (this.options.holderLookupError) throw new Error(this.options.holderLookupError)

    return this.options.holderConnectionId ?? null
  }
}
