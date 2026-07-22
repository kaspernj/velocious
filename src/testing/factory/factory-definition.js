// @ts-check

/**
 * An immutable compiled factory. Definitions never mutate after compilation;
 * `modify` produces a replacement rather than editing an existing one. Parent and
 * trait references are resolved lazily at evaluation time, so a child may be
 * declared before its parent.
 */
export default class FactoryDefinition {
  /**
   * Builds a factory definition.
   * @param {object} args - Options.
   * @param {string} args.name - Factory name.
   * @param {(new (attributes?: Record<string, ?>) => ?) | null} args.modelClass - Model class, or null to inherit from a parent.
   * @param {string | null} args.parentName - Parent factory name, or null.
   * @param {string[]} args.aliases - Alias names that reference this same definition.
   * @param {import("./declarations.js").Declaration[]} args.declarations - Ordered own declarations.
   * @param {Map<string, import("./trait-definition.js").default>} args.localTraits - Factory-local traits keyed by name.
   */
  constructor({name, modelClass, parentName, aliases, declarations, localTraits}) {
    /** @type {string} - Factory name. */
    this.name = name

    /** @type {(new (attributes?: Record<string, ?>) => ?) | null} - Model class or null. */
    this.modelClass = modelClass

    /** @type {string | null} - Parent factory name or null. */
    this.parentName = parentName

    /** @type {Array<string>} - Alias names. */
    this.aliases = /** @type {Array<string>} */ (Object.freeze([...aliases]))

    /** @type {Array<import("./declarations.js").Declaration>} - Ordered own declarations. */
    this.declarations = /** @type {Array<import("./declarations.js").Declaration>} */ (Object.freeze([...declarations]))

    /** @type {Map<string, import("./trait-definition.js").default>} - Factory-local traits. */
    this.localTraits = localTraits

    Object.freeze(this)
  }
}
