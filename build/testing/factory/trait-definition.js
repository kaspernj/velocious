// @ts-check

/**
 * An immutable compiled trait. A trait carries an ordered list of declarations
 * (attributes, transients, associations, callbacks, custom construction, and
 * base-trait inclusions) that are mixed into a factory run.
 */
export default class TraitDefinition {
  /**
   * Builds a trait definition.
   * @param {object} args - Options.
   * @param {string} args.name - Trait name.
   * @param {import("./declarations.js").Declaration[]} args.declarations - Ordered declarations.
   */
  constructor({name, declarations}) {
    /** @type {string} - Trait name. */
    this.name = name

    /** @type {Array<import("./declarations.js").Declaration>} - Ordered declarations. */
    this.declarations = /** @type {Array<import("./declarations.js").Declaration>} */ (Object.freeze([...declarations]))

    Object.freeze(this)
  }
}
