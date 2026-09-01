/**
 * A single factory run's evaluation state. It resolves attributes/transients/
 * associations lazily and memoizes each name exactly once per run (sharing an
 * in-flight promise between concurrent dependents). Cycle detection uses a
 * per-chain path so genuine recursion is reported while concurrent sibling reads
 * of the same name are allowed.
 */
export default class EvaluationContext {
    /** @type {import("./factory-registry.js").default} - Owning registry. */
    registry: import("./factory-registry.js").default;
    /** @type {import("./factory-runner.js").CompiledPlan} - Compiled run plan. */
    plan: import("./factory-runner.js").CompiledPlan;
    /** @type {"attributesFor" | "build" | "create"} - Active strategy. */
    strategy: "attributesFor" | "build" | "create";
    /** @type {Map<string, ReturnType<typeof JSON.parse>>} - Per-run memoized values / in-flight promises. */
    _memo: Map<string, ReturnType<typeof JSON.parse>>;
    /**
     * Builds an evaluation context.
     * @param {object} args - Options.
     * @param {import("./factory-registry.js").default} args.registry - Owning registry.
     * @param {import("./factory-runner.js").CompiledPlan} args.plan - Compiled run plan.
     * @param {"attributesFor" | "build" | "create"} args.strategy - Active strategy.
     */
    constructor({ registry, plan, strategy }: {
        registry: import("./factory-registry.js").default;
        plan: import("./factory-runner.js").CompiledPlan;
        strategy: "attributesFor" | "build" | "create";
    });
    /**
     * Builds the named evaluator context handed to lazy values and callbacks for a
     * given dependency path.
     * @param {string[]} path - Current resolution path (for cycle detection).
     * @returns {{get: (name: string) => Promise<ReturnType<typeof JSON.parse>>, generate: (name: string) => Promise<ReturnType<typeof JSON.parse>>, association: (factory: string, ...args: Array<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>}} - The evaluator context.
     */
    contextFor(path: string[]): {
        get: (name: string) => Promise<ReturnType<typeof JSON.parse>>;
        generate: (name: string) => Promise<ReturnType<typeof JSON.parse>>;
        association: (factory: string, ...args: Array<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>;
    };
    /**
     * Resolves an attribute/transient/association by name, memoizing the result.
     * @param {string} name - Name to resolve.
     * @param {string[]} path - Current resolution path.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The resolved value.
     */
    _get(name: string, path: string[]): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Evaluates a resolved slot, honouring lazy functions and overrides.
     * @param {import("./factory-runner.js").Slot} slot - Slot to evaluate.
     * @param {string[]} childPath - Path including this slot's name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The evaluated value.
     */
    _evaluateSlot(slot: import("./factory-runner.js").Slot, childPath: string[]): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Resolves a declared/overridden association slot. An explicit object/null
     * override suppresses nested factory execution and is returned verbatim.
     * @param {import("./factory-runner.js").Slot} slot - Association slot.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The associated record (or override value).
     */
    _resolveAssociationSlot(slot: import("./factory-runner.js").Slot): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs an explicitly-invoked association from a lazy value's `association(...)`.
     * @param {string} factoryName - Factory to run.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Traits and/or an overrides object.
     * @param {string[]} _path - Current resolution path (unused; associations open a fresh run).
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The associated record, or null under attributesFor.
     */
    _explicitAssociation(factoryName: string, args: Array<ReturnType<typeof JSON.parse>>, _path: string[]): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Resolves every plain attribute slot (used by attributesFor). Transients and
     * associations are omitted, though transients may still be evaluated on demand
     * as dependencies.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - The resolved attributes.
     */
    resolveAttributes(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves every transient before callbacks that expose them as plain properties.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Evaluated transient values.
     */
    resolveTransients(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves everything needed to construct a record: public attributes,
     * transients, and associated records.
     * @returns {Promise<{publicAttributes: Record<string, ReturnType<typeof JSON.parse>>, transients: Record<string, ReturnType<typeof JSON.parse>>, associations: Array<{name: string, record: ReturnType<typeof JSON.parse>}>}>} - Resolved construction inputs.
     */
    resolveForConstruction(): Promise<{
        publicAttributes: Record<string, ReturnType<typeof JSON.parse>>;
        transients: Record<string, ReturnType<typeof JSON.parse>>;
        associations: Array<{
            name: string;
            record: ReturnType<typeof JSON.parse>;
        }>;
    }>;
}
//# sourceMappingURL=evaluation-context.d.ts.map