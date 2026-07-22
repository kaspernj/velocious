// @ts-check

import {InvalidDefinitionError} from "./errors.js"

/**
 * A declared association. It records the relationship name, the factory to run
 * (defaulting to the relationship name), any traits/overrides passed to that
 * factory, and an optional explicit strategy. When no strategy is given the
 * association follows the parent strategy at evaluation time.
 */
export default class AssociationDeclaration {
  /**
   * Builds an association declaration.
   * @param {object} args - Options.
   * @param {string} args.name - Relationship name on the owning model.
   * @param {string} [args.factory] - Factory name to run. Defaults to the relationship name.
   * @param {string[]} [args.traits] - Traits passed to the association factory.
   * @param {Record<string, ?>} [args.overrides] - Overrides passed to the association factory.
   * @param {"build" | "create" | undefined} [args.strategy] - Explicit strategy override.
   */
  constructor({name, factory, traits = [], overrides = {}, strategy}) {
    if (!name || typeof name !== "string") {
      throw new InvalidDefinitionError(`Association name must be a non-empty string, got: ${String(name)}`)
    }

    if (strategy !== undefined && strategy !== "build" && strategy !== "create") {
      throw new InvalidDefinitionError(`Association strategy must be "build" or "create", got: ${String(strategy)}`)
    }

    /** @type {"association"} - Discriminant. */
    this.kind = "association"

    /** @type {string} - Relationship name on the owning model. */
    this.name = name

    /** @type {string} - Factory name to run for the association. */
    this.factory = factory || name

    /** @type {string[]} - Traits passed to the association factory. */
    this.traits = traits

    /** @type {Record<string, ?>} - Overrides passed to the association factory. */
    this.overrides = overrides

    /** @type {"build" | "create" | undefined} - Explicit strategy override. */
    this.strategy = strategy

    Object.freeze(this)
  }
}
