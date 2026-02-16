// @ts-check

import Configuration from "./configuration.js"
import {CurrentConfigurationNotSetError} from "./configuration.js"

export default class Current {
  /**
   * @returns {import("./configuration.js").default} - Current configuration.
   */
  static configuration() {
    return Configuration.current()
  }

  /**
   * @returns {import("./authorization/ability.js").default | undefined} - Current ability.
   */
  static ability() {
    try {
      return this.configuration().getCurrentAbility()
    } catch (error) {
      if (error instanceof CurrentConfigurationNotSetError) return

      throw error
    }
  }

  /**
   * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
   * @returns {void} - No return value.
   */
  static setAbility(ability) {
    this.configuration().getEnvironmentHandler().setCurrentAbility(ability)
  }

  /**
   * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
   * @param {() => Promise<any>} callback - Callback.
   * @returns {Promise<any>} - Callback result.
   */
  static async withAbility(ability, callback) {
    return await this.configuration().runWithAbility(ability, callback)
  }
}
