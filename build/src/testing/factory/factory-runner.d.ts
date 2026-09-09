export type Slot = {
    /**
     * - Slot nature.
     */
    slotKind: "attribute" | "transient" | "association";
    /**
     * - Literal/lazy value, override value, or AssociationDeclaration.
     */
    value: ReturnType<typeof JSON.parse>;
    /**
     * - Whether the value came from a call-site override.
     */
    isOverride: boolean;
};
export type CompiledPlan = {
    /**
     * - Target factory name.
     */
    factoryName: string;
    /**
     * - Target definition.
     */
    factoryDefinition: import("./factory-definition.js").default;
    /**
     * - Resolved model class.
     */
    modelClass: (new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null;
    /**
     * - Inheritance chain names (child last) for sequence scope.
     */
    chainNames: string[];
    /**
     * - Name→slot map (last declaration wins).
     */
    resolved: Map<string, Slot>;
    /**
     * - Deduped callbacks by event.
     */
    callbacks: Map<string, import("./declarations.js").CallbackDeclaration[]>;
    /**
     * - Custom constructor, or null.
     */
    initializeWith: import("./declarations.js").InitializeWithDeclaration["fn"] | null;
    /**
     * - Custom persistence, or null.
     */
    toCreate: import("./declarations.js").ToCreateDeclaration["fn"] | null;
    /**
     * - Whether persistence is skipped.
     */
    skipCreate: boolean;
};
/**
 * A resolved attribute/transient/association slot in a compiled plan.
 * @typedef {object} Slot
 * @property {"attribute" | "transient" | "association"} slotKind - Slot nature.
 * @property {ReturnType<typeof JSON.parse>} value - Literal/lazy value, override value, or AssociationDeclaration.
 * @property {boolean} isOverride - Whether the value came from a call-site override.
 */
/**
 * The immutable result of compiling a factory invocation.
 * @typedef {object} CompiledPlan
 * @property {string} factoryName - Target factory name.
 * @property {import("./factory-definition.js").default} factoryDefinition - Target definition.
 * @property {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} modelClass - Resolved model class.
 * @property {string[]} chainNames - Inheritance chain names (child last) for sequence scope.
 * @property {Map<string, Slot>} resolved - Name→slot map (last declaration wins).
 * @property {Map<string, import("./declarations.js").CallbackDeclaration[]>} callbacks - Deduped callbacks by event.
 * @property {import("./declarations.js").InitializeWithDeclaration["fn"] | null} initializeWith - Custom constructor, or null.
 * @property {import("./declarations.js").ToCreateDeclaration["fn"] | null} toCreate - Custom persistence, or null.
 * @property {boolean} skipCreate - Whether persistence is skipped.
 */
/**
 * Compiles factory invocations into immutable plans by resolving the inheritance
 * chain, expanding base and requested traits, and folding declarations into a
 * name→slot map plus a deduped, ordered callback set.
 */
export default class FactoryRunner {
    /** @type {import("./factory-registry.js").default} - Owning registry. */
    registry: import("./factory-registry.js").default;
    /**
     * Builds a runner.
     * @param {import("./factory-registry.js").default} registry - Owning registry.
     */
    constructor(registry: import("./factory-registry.js").default);
    /**
     * Compiles a factory invocation into a plan.
     * @param {string} factoryName - Factory to run.
     * @param {string[]} requestedTraits - Traits requested at the call site, in order.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Call-site overrides (highest precedence).
     * @returns {CompiledPlan} - The compiled plan.
     */
    compile(factoryName: string, requestedTraits: string[], overrides: Record<string, ReturnType<typeof JSON.parse>>): CompiledPlan;
    /**
     * Compiles inheritance, traits and declarations without call-site overrides.
     * @param {string} factoryName - Factory to run.
     * @param {string[]} requestedTraits - Traits requested at the call site, in order.
     * @returns {CompiledPlan} - Reusable declaration plan.
     */
    compileTemplate(factoryName: string, requestedTraits: string[]): CompiledPlan;
    /**
     * Applies the current call-site overrides without mutating the reusable template.
     * @param {CompiledPlan} planTemplate - Reusable declaration plan.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Current call-site overrides.
     * @returns {CompiledPlan} - Per-invocation plan.
     */
    applyOverrides(planTemplate: CompiledPlan, overrides: Record<string, ReturnType<typeof JSON.parse>>): CompiledPlan;
    /**
     * Resolves the inheritance chain from the root parent down to the target.
     * @param {string} factoryName - Target factory name.
     * @returns {import("./factory-definition.js").default[]} - Chain (root first, target last).
     */
    _resolveChain(factoryName: string): import("./factory-definition.js").default[];
    /**
     * Resolves a factory definition by name (or alias).
     * @param {string} factoryName - Factory name.
     * @returns {import("./factory-definition.js").default} - The definition.
     */
    _resolveFactory(factoryName: string): import("./factory-definition.js").default;
    /**
     * Picks the nearest declared model class in the chain (child overrides parent).
     * @param {import("./factory-definition.js").default[]} chain - Inheritance chain.
     * @returns {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} - The model class, or null.
     */
    _resolveModelClass(chain: import("./factory-definition.js").default[]): (new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null;
    /**
     * Expands one factory's own declarations, inlining base-trait inclusions.
     * @param {import("./factory-definition.js").default} factoryDefinition - Factory whose declarations are expanded.
     * @param {import("./factory-definition.js").default} scope - Target factory (for local-trait resolution).
     * @param {Array<{decl: import("./declarations.js").Declaration}>} out - Flattened output sink.
     * @returns {void}
     */
    _expandFactoryDeclarations(factoryDefinition: import("./factory-definition.js").default, scope: import("./factory-definition.js").default, out: Array<{
        decl: import("./declarations.js").Declaration;
    }>): void;
    /**
     * Expands a trait (resolving factory-local before global) and its inclusions.
     * @param {string} traitName - Trait to expand.
     * @param {import("./factory-definition.js").default} scope - Target factory (for local-trait resolution).
     * @param {Array<{decl: import("./declarations.js").Declaration}>} out - Flattened output sink.
     * @param {string[]} activePath - Trait inclusion path (for cycle detection).
     * @returns {void}
     */
    _expandTrait(traitName: string, scope: import("./factory-definition.js").default, out: Array<{
        decl: import("./declarations.js").Declaration;
    }>, activePath: string[]): void;
    /**
     * Resolves a local trait from the current factory upward through its parents.
     * @param {string} traitName - Trait name to resolve.
     * @param {import("./factory-definition.js").default} scope - Declaring/requesting factory scope.
     * @returns {{trait: import("./trait-definition.js").default, scope: import("./factory-definition.js").default} | undefined} - Nearest local trait and its declaring scope, if any.
     */
    _resolveLocalTrait(traitName: string, scope: import("./factory-definition.js").default): {
        trait: import("./trait-definition.js").default;
        scope: import("./factory-definition.js").default;
    } | undefined;
    /**
     * Folds flattened declarations into a reusable compiled plan.
     * @param {object} args - Options.
     * @param {Array<{decl: import("./declarations.js").Declaration}>} args.flattened - Flattened declarations.
     * @param {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} args.modelClass - Resolved model class.
     * @param {import("./factory-definition.js").default} args.target - Target factory definition.
     * @param {string[]} args.chainNames - Inheritance chain names.
     * @returns {CompiledPlan} - The compiled plan.
     */
    _buildPlan({ flattened, modelClass, target, chainNames }: {
        flattened: Array<{
            decl: import("./declarations.js").Declaration;
        }>;
        modelClass: (new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null;
        target: import("./factory-definition.js").default;
        chainNames: string[];
    }): CompiledPlan;
    /**
     * Applies belongs-to override precedence using the declared model relationship's
     * real foreign-key metadata. An explicit association object wins over its key;
     * otherwise an explicit key suppresses the factory-declared association.
     * @param {Map<string, Slot>} resolved - Folded slots.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Call-site overrides.
     * @param {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} modelClass - Resolved model class.
     * @returns {void}
     */
    _arbitrateAssociationOverrides(resolved: Map<string, Slot>, overrides: Record<string, ReturnType<typeof JSON.parse>>, modelClass: (new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null): void;
}
//# sourceMappingURL=factory-runner.d.ts.map