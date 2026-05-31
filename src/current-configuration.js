// @ts-check

/** @type {{currentConfiguration: import("./configuration.js").default | null}} */
const shared = {
  currentConfiguration: null
}

class CurrentConfigurationNotSetError extends Error {}

/**
 * @returns {import("./configuration.js").default} - Current configuration.
 */
export function currentConfiguration() {
  if (!shared.currentConfiguration) throw new CurrentConfigurationNotSetError("A current configuration hasn't been set")

  return shared.currentConfiguration
}

/**
 * @param {import("./configuration.js").default} configuration - Current configuration.
 * @returns {void} - No return value.
 */
export function setCurrentConfiguration(configuration) {
  shared.currentConfiguration = configuration
}

export {CurrentConfigurationNotSetError}
