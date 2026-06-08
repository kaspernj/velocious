// @ts-check

import FrontendModelBase from "../../src/frontend-models/base.js"

export class RansackUser extends FrontendModelBase {
  /**
   * @returns {{abilities: string[], attributes: string[], builtInCollectionCommands: string[], modelName: string, primaryKey: string}} - Resource config.
   */
  static resourceConfig() {
    return {
      abilities: ["read"],
      attributes: ["id", "email", "reference"],
      builtInCollectionCommands: ["index"],
      modelName: "User",
      primaryKey: "id"
    }
  }

  /** @returns {string} - Email address. */
  // fallow-ignore-next-line unused-class-member
  email() { return this.readAttribute("email") }
}

FrontendModelBase.registerModel(RansackUser)

/** @returns {void} */
export function resetRansackTransport() {
  FrontendModelBase.configureTransport({
    url: undefined,
    websocketClient: undefined
  })
}

/**
 * @param {string} url - Frontend-model endpoint URL.
 * @returns {void}
 */
export function configureRansackTransport(url) {
  FrontendModelBase.configureTransport({url})
}
