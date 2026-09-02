/**
 * An immutable compiled factory. Definitions never mutate after compilation;
 * `modify` produces a replacement rather than editing an existing one. Parent and
 * trait references are resolved lazily at evaluation time, so a child may be
 * declared before its parent.
 */
export default class FactoryDefinition {
    /** @type {string} - Factory name. */
    name: string;
    /** @type {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} - Model class or null. */
    modelClass: (new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null;
    /** @type {string | null} - Parent factory name or null. */
    parentName: string | null;
    /** @type {Array<string>} - Alias names. */
    aliases: Array<string>;
    /** @type {Array<import("./declarations.js").Declaration>} - Ordered own declarations. */
    declarations: Array<import("./declarations.js").Declaration>;
    /** @type {Map<string, import("./trait-definition.js").default>} - Factory-local traits. */
    localTraits: Map<string, import("./trait-definition.js").default>;
    /**
     * Builds a factory definition.
     * @param {object} args - Options.
     * @param {string} args.name - Factory name.
     * @param {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} args.modelClass - Model class, or null to inherit from a parent.
     * @param {string | null} args.parentName - Parent factory name, or null.
     * @param {string[]} args.aliases - Alias names that reference this same definition.
     * @param {import("./declarations.js").Declaration[]} args.declarations - Ordered own declarations.
     * @param {Map<string, import("./trait-definition.js").default>} args.localTraits - Factory-local traits keyed by name.
     */
    constructor({ name, modelClass, parentName, aliases, declarations, localTraits }: {
        name: string;
        modelClass: (new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null;
        parentName: string | null;
        aliases: string[];
        declarations: import("./declarations.js").Declaration[];
        localTraits: Map<string, import("./trait-definition.js").default>;
    });
}
//# sourceMappingURL=factory-definition.d.ts.map