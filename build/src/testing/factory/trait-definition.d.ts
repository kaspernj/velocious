/**
 * An immutable compiled trait. A trait carries an ordered list of declarations
 * (attributes, transients, associations, callbacks, custom construction, and
 * base-trait inclusions) that are mixed into a factory run.
 */
export default class TraitDefinition {
    /** @type {string} - Trait name. */
    name: string;
    /** @type {Array<import("./declarations.js").Declaration>} - Ordered declarations. */
    declarations: Array<import("./declarations.js").Declaration>;
    /**
     * Builds a trait definition.
     * @param {object} args - Options.
     * @param {string} args.name - Trait name.
     * @param {import("./declarations.js").Declaration[]} args.declarations - Ordered declarations.
     */
    constructor({ name, declarations }: {
        name: string;
        declarations: import("./declarations.js").Declaration[];
    });
}
//# sourceMappingURL=trait-definition.d.ts.map