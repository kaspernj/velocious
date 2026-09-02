/**
 * A declared association. It records the relationship name, the factory to run
 * (defaulting to the relationship name), any traits/overrides passed to that
 * factory, and an optional explicit strategy. When no strategy is given the
 * association follows the parent strategy at evaluation time.
 */
export default class AssociationDeclaration {
    /** @type {"association"} - Discriminant. */
    kind: "association";
    /** @type {string} - Relationship name on the owning model. */
    name: string;
    /** @type {string} - Factory name to run for the association. */
    factory: string;
    /** @type {string[]} - Traits passed to the association factory. */
    traits: string[];
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} - Overrides passed to the association factory. */
    overrides: Record<string, ReturnType<typeof JSON.parse>>;
    /** @type {"build" | "create" | undefined} - Explicit strategy override. */
    strategy: "build" | "create" | undefined;
    /**
     * Builds an association declaration.
     * @param {object} args - Options.
     * @param {string} args.name - Relationship name on the owning model.
     * @param {string} [args.factory] - Factory name to run. Defaults to the relationship name.
     * @param {string[]} [args.traits] - Traits passed to the association factory.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.overrides] - Overrides passed to the association factory.
     * @param {"build" | "create" | undefined} [args.strategy] - Explicit strategy override.
     */
    constructor({ name, factory, traits, overrides, strategy }: {
        name: string;
        factory?: string;
        traits?: string[];
        overrides?: Record<string, ReturnType<typeof JSON.parse>>;
        strategy?: "build" | "create" | undefined;
    });
}
//# sourceMappingURL=association-declaration.d.ts.map