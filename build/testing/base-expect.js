// @ts-check

export default class BaseExpect {
  /**
   * Runs run before.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runBefore() { /* do nothing */ }

  /**
   * Runs run after.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runAfter() { /* do nothing */ }
}
