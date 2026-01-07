// @ts-check

export default class BaseExpect {
  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runBefore() { /* do nothing */ }

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runAfter() { /* do nothing */ }
}
