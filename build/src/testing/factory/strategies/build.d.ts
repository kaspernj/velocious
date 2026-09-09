import BaseStrategy from "./base.js";
/**
 * The `build` strategy. It recursively builds associated models (using the parent
 * strategy) and constructs the root record without persisting anything. Runs the
 * beforeAll/beforeBuild/afterBuild callbacks and guarantees afterAll cleanup.
 */
export default class BuildStrategy extends BaseStrategy {
    /**
     * Runs the strategy.
     * @param {object} args - Options.
     * @param {import("../factory-registry.js").default} args.registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} args.plan - Compiled plan.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The built (unsaved) record.
     */
    run({ registry, plan }: {
        registry: import("../factory-registry.js").default;
        plan: import("../factory-runner.js").CompiledPlan;
    }): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=build.d.ts.map