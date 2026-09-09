// @ts-check

/**
 * Exclusive lease installed on a shared physical connection while one
 * operation-scoped transaction owns it.
 */
export default class VelociousDatabaseOperationLease {
  /**
   * Runs constructor.
   * @param {symbol} owner - Opaque operation owner token.
   */
  constructor(owner) {
    this.owner = owner
    this.released = false
    /**
     * Resolves the lease waiters.
     * @type {() => void} */
    let release = () => {}

    this.releasedPromise = new Promise((resolve) => {
      release = () => resolve(undefined)
    })
    this.releasePromise = release
  }

  /**
   * Waits until the lease is released unless `owner` owns it.
   * @param {symbol | undefined} owner - Candidate operation owner.
   * @returns {Promise<void>} - Resolves when access is allowed.
   */
  async wait(owner) {
    if (owner === this.owner) return

    await this.releasedPromise
  }

  /**
   * Releases all waiters exactly once.
   * @returns {void}
   */
  release() {
    if (this.released) return

    this.released = true
    this.releasePromise()
  }
}
