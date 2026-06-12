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
  // Register RansackUser (modelName "User") lazily, when a ransack spec actually configures its
  // transport, rather than at module load. Registering at module load globally clobbered the real
  // "User" frontend model for every other spec loaded in the same run (e.g. base http integration
  // hydration), since the test runner loads all spec modules up front.
  FrontendModelBase.registerModel(RansackUser)
  FrontendModelBase.configureTransport({url})
}
