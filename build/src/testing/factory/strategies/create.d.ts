import BaseStrategy from "./base.js";
/**
 * The `create` strategy. It builds the object graph (associations use the parent
 * create strategy by default), runs beforeAll/beforeBuild/afterBuild, persists the
 * root record through its native `save()` (letting Velocious own association
 * autosave order and validation) or a custom `toCreate`, then runs
 * beforeCreate/afterCreate and guarantees afterAll cleanup.
 */
export default class CreateStrategy extends BaseStrategy {
    /**
     * Runs the strategy.
     * @param {object} args - Options.
     * @param {import("../factory-registry.js").default} args.registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} args.plan - Compiled plan.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The persisted record.
     */
    run({ registry, plan }: {
        registry: import("../factory-registry.js").default;
        plan: import("../factory-runner.js").CompiledPlan;
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Persists the record via a custom `toCreate`, native `save()`, or not at all
     * when `skipCreate` is declared.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {ReturnType<typeof JSON.parse>} record - The record to persist.
     * @param {import("../evaluation-context.js").default} context - Evaluation context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} transients - Evaluated transients.
     * @returns {Promise<void>} - Resolves when persistence completes.
     */
    _persist(plan: import("../factory-runner.js").CompiledPlan, record: ReturnType<typeof JSON.parse>, context: import("../evaluation-context.js").default, transients: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
}
//# sourceMappingURL=create.d.ts.map