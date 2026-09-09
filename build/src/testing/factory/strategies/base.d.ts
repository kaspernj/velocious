import EvaluationContext from "../evaluation-context.js";
/**
 * Shared behaviour for the build/create/attributesFor strategies: evaluation
 * context creation, deterministic callback execution, guaranteed `afterAll`
 * cleanup, record construction (default and `initializeWith`), and association
 * wiring through public relationship reflection.
 */
export default class BaseStrategy {
    /**
     * Creates an evaluation context for a plan.
     * @param {import("../factory-registry.js").default} registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {"attributesFor" | "build" | "create"} strategyName - Strategy name.
     * @returns {EvaluationContext} - The context.
     */
    _newContext(registry: import("../factory-registry.js").default, plan: import("../factory-runner.js").CompiledPlan, strategyName: "attributesFor" | "build" | "create"): EvaluationContext;
    /**
     * Builds the callback `context` object: evaluated transients exposed as plain
     * properties (no Proxy) plus the named evaluator methods.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} transients - Evaluated transient values.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The callback context.
     */
    _callbackContext(context: EvaluationContext, transients: Record<string, ReturnType<typeof JSON.parse>>): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs every deduped callback for an event in declaration order.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {string} event - Event name (e.g. "afterCreate").
     * @param {{record: ReturnType<typeof JSON.parse>, transients: Record<string, ReturnType<typeof JSON.parse>>, strategy: string}} state - Current record/transients/strategy.
     * @returns {Promise<void>} - Resolves when all callbacks complete.
     */
    _runCallbacks(context: EvaluationContext, plan: import("../factory-runner.js").CompiledPlan, event: string, state: {
        record: ReturnType<typeof JSON.parse>;
        transients: Record<string, ReturnType<typeof JSON.parse>>;
        strategy: string;
    }): Promise<void>;
    /**
     * Runs `body`, then guarantees `afterAll` runs in `finally`. When both the body
     * and cleanup fail, the body's primary error is preserved and the cleanup error
     * is attached as a detail rather than masking it.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {() => {record: ReturnType<typeof JSON.parse>, transients: Record<string, ReturnType<typeof JSON.parse>>, strategy: string}} state - Late-bound state accessor.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} body - The strategy body.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The body's result.
     */
    _runWithAfterAll(context: EvaluationContext, plan: import("../factory-runner.js").CompiledPlan, state: () => {
        record: ReturnType<typeof JSON.parse>;
        transients: Record<string, ReturnType<typeof JSON.parse>>;
        strategy: string;
    }, body: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Attaches an afterAll cleanup failure to the primary error without masking it.
     * @param {ReturnType<typeof JSON.parse>} primaryError - The original error that will propagate.
     * @param {ReturnType<typeof JSON.parse>} cleanupError - The afterAll cleanup failure.
     * @returns {void}
     */
    _attachCleanupFailure(primaryError: ReturnType<typeof JSON.parse>, cleanupError: ReturnType<typeof JSON.parse>): void;
    /**
     * Constructs a record from evaluated public attributes, honouring a custom
     * `initializeWith` constructor and never assigning constructor-consumed
     * attributes twice.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} publicAttributes - Evaluated public attributes.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} transients - Evaluated transients.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The constructed record.
     */
    _constructRecord(plan: import("../factory-runner.js").CompiledPlan, publicAttributes: Record<string, ReturnType<typeof JSON.parse>>, context: EvaluationContext, transients: Record<string, ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Constructs a record via a custom `initializeWith`, tracking which attributes
     * the constructor consumed through its `get(name)` accessor and assigning only
     * the remaining public attributes afterwards.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => import("../../../database/record/index.js").default} ModelClass - Validated declared model class.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} publicAttributes - Evaluated public attributes.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} transients - Evaluated transients.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The constructed record.
     */
    _constructWithInitializer(plan: import("../factory-runner.js").CompiledPlan, ModelClass: new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => import("../../../database/record/index.js").default, publicAttributes: Record<string, ReturnType<typeof JSON.parse>>, context: EvaluationContext, transients: Record<string, ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Wires evaluated associations onto a record through public relationship
     * reflection and generated setters (never private caches or guessed keys).
     * @param {ReturnType<typeof JSON.parse>} record - The owning record.
     * @param {Array<{name: string, record: ReturnType<typeof JSON.parse>}>} associations - Evaluated associations.
     * @returns {void}
     */
    _assignAssociations(record: ReturnType<typeof JSON.parse>, associations: Array<{
        name: string;
        record: ReturnType<typeof JSON.parse>;
    }>): void;
    /**
     * Normalizes a has-many association value into an array of records.
     * @param {ReturnType<typeof JSON.parse>} value - Association value (record, array, or null).
     * @returns {Array<ReturnType<typeof JSON.parse>>} - The normalized record array.
     */
    _toRecordArray(value: ReturnType<typeof JSON.parse>): Array<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=base.d.ts.map