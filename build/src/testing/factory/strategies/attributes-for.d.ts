import BaseStrategy from "./base.js";
/**
 * The `attributesFor` strategy. It resolves scalar/lazy attributes (and any
 * transients they depend on) but never initializes the model, runs lifecycle
 * callbacks, or evaluates/builds declared associations. Transients and
 * associations are omitted from the returned plain object.
 */
export default class AttributesForStrategy extends BaseStrategy {
    /**
     * Runs the strategy.
     * @param {object} args - Options.
     * @param {import("../factory-registry.js").default} args.registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} args.plan - Compiled plan.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - The resolved attributes.
     */
    run({ registry, plan }: {
        registry: import("../factory-registry.js").default;
        plan: import("../factory-runner.js").CompiledPlan;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
}
//# sourceMappingURL=attributes-for.d.ts.map