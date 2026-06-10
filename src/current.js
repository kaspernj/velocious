// @ts-check

import Configuration from "./configuration.js"
import {CurrentConfigurationNotSetError} from "./configuration.js"

export default class Current {
  /**
   * Runs configuration.
   * @returns {import("./configuration.js").default} - Current configuration.
   */
  static configuration() {
    return Configuration.current()
  }

  /**
   * Runs ability.
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
   * Runs set ability.
   * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
   * @returns {void} - No return value.
   */
  static setAbility(ability) {
    this.configuration().getEnvironmentHandler().setCurrentAbility(ability)
  }

  /**
   * Runs with ability.
   * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  static async withAbility(ability, callback) {
    return await this.configuration().runWithAbility(ability, callback)
  }

  /**
   * Runs tenant.
   * @returns {?} - Current tenant.
   */
  static tenant() {
    try {
      return this.configuration().getCurrentTenant()
    } catch (error) {
      if (error instanceof CurrentConfigurationNotSetError) return

      throw error
    }
  }

  /**
   * Runs set tenant.
   * @param {?} tenant - Tenant.
   * @returns {void} - No return value.
   */
  static setTenant(tenant) {
    this.configuration().getEnvironmentHandler().setCurrentTenant(tenant)
  }

  /**
   * Runs with tenant.
   * @param {?} tenant - Tenant.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  static async withTenant(tenant, callback) {
    return await this.configuration().runWithTenant(tenant, callback)
  }
}
