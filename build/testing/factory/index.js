// @ts-check

import FactoryRegistry from "./factory-registry.js"

/**
 * The default, convenient factory registry singleton. Import it as `Factory` and
 * call `Factory.define(...)`, `Factory.build(...)`, `Factory.create(...)`,
 * `Factory.attributesFor(...)` and the list/pair helpers. This module is
 * browser/Metro-safe: it contains no Node built-ins, filesystem discovery, or
 * raw `import.meta`. Node-only definition loading lives in `./node/load-definitions.js`.
 * @type {FactoryRegistry}
 */
const Factory = new FactoryRegistry()

/**
 * Creates a fresh, isolated factory registry independent of the default singleton
 * (for libraries or spec groups that must not share global factory state).
 * @returns {FactoryRegistry} - A new registry.
 */
export function createFactoryRegistry() {
  return new FactoryRegistry()
}

export default Factory
