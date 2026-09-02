// @ts-check

/**
 * DummyAccessScopeObserver type.
 * @typedef {object} DummyAccessScopeObserverType
 * @property {() => ({revoked: boolean} | undefined)} captureScope - Captures the active scope.
 * @property {{revoked: boolean} | undefined} observedStartupScope - Scope observed at startup.
 * @property {(callback: () => ({revoked: boolean} | undefined)) => void} setScopeCapture - Configures scope capture.
 * @property {() => ({revoked: boolean} | undefined)} startupScope - Returns the observed startup scope.
 * @property {(callback: () => Promise<void>) => Promise<void>} run - Runs fake Dummy startup.
 */

/** @type {DummyAccessScopeObserverType} */
const DummyAccessScopeObserver = {
  captureScope: () => undefined,
  observedStartupScope: undefined,
  setScopeCapture(callback) {
    this.captureScope = callback
    this.observedStartupScope = undefined
  },
  startupScope() {
    return this.observedStartupScope
  },
  async run(callback) {
    this.observedStartupScope = this.captureScope()
    await callback()
  }
}

export default DummyAccessScopeObserver
