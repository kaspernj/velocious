// @ts-check
import * as inflection from "inflection";
import { assertModelClass } from "../model-contract.js";
import { ModelContractError } from "../errors.js";
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
    _newContext(registry, plan, strategyName) {
        return new EvaluationContext({ registry, plan, strategy: strategyName });
    }
    /**
     * Builds the callback `context` object: evaluated transients exposed as plain
     * properties (no Proxy) plus the named evaluator methods.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} transients - Evaluated transient values.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The callback context.
     */
    _callbackContext(context, transients) {
        return Object.assign({}, transients, context.contextFor([]));
    }
    /**
     * Runs every deduped callback for an event in declaration order.
     * @param {EvaluationContext} context - Evaluation context.
     * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
     * @param {string} event - Event name (e.g. "afterCreate").
     * @param {{record: ReturnType<typeof JSON.parse>, transients: Record<string, ReturnType<typeof JSON.parse>>, strategy: string}} state - Current record/transients/strategy.
     * @returns {Promise<void>} - Resolves when all callbacks complete.
     */
    async _runCallbacks(context, plan, event, state) {
        const callbacks = plan.callbacks.get(event);
        if (!callbacks)
            return;
        const callbackContext = this._callbackContext(context, state.transients);
        for (const callback of callbacks) {
            await callback.fn({ record: state.record, context: callbackContext, strategy: state.strategy });
        }
    }
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
    async _runWithAfterAll(context, plan, state, body) {
        /** @type {ReturnType<typeof JSON.parse>} */
        let result;
        /** @type {ReturnType<typeof JSON.parse>} */
        let primaryError;
        let hasPrimaryError = false;
        try {
            result = await body();
        }
        catch (error) {
            primaryError = error;
            hasPrimaryError = true;
        }
        /** @type {ReturnType<typeof JSON.parse>} */
        let cleanupError;
        let hasCleanupError = false;
        try {
            await this._runCallbacks(context, plan, "afterAll", state());
        }
        catch (error) {
            cleanupError = error;
            hasCleanupError = true;
        }
        if (hasPrimaryError) {
            if (hasCleanupError)
                this._attachCleanupFailure(primaryError, cleanupError);
            throw primaryError;
        }
        if (hasCleanupError)
            throw cleanupError;
        return result;
    }
    /**
     * Attaches an afterAll cleanup failure to the primary error without masking it.
     * @param {ReturnType<typeof JSON.parse>} primaryError - The original error that will propagate.
     * @param {ReturnType<typeof JSON.parse>} cleanupError - The afterAll cleanup failure.
     * @returns {void}
     */
    _attachCleanupFailure(primaryError, cleanupError) {
        if (!primaryError || typeof primaryError !== "object" || !Object.isExtensible(primaryError))
            return;
        if (!Array.isArray(primaryError.factoryCleanupErrors))
            primaryError.factoryCleanupErrors = [];
        primaryError.factoryCleanupErrors.push(cleanupError);
    }
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
    async _constructRecord(plan, publicAttributes, context, transients) {
        const ModelClass = assertModelClass(plan.modelClass, plan.factoryName);
        if (plan.initializeWith) {
            return await this._constructWithInitializer(plan, ModelClass, publicAttributes, context, transients);
        }
        return new ModelClass(publicAttributes);
    }
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
    async _constructWithInitializer(plan, ModelClass, publicAttributes, context, transients) {
        /** @type {Set<string>} */
        const consumed = new Set();
        const get = (/** @type {string} */ name) => {
            consumed.add(name);
            return publicAttributes[name];
        };
        const initializeWith = /** @type {import("../declarations.js").InitializeWithDeclaration["fn"]} */ (plan.initializeWith);
        const record = await initializeWith({ attributes: { ...publicAttributes }, get, context: this._callbackContext(context, transients) });
        if (!(record instanceof ModelClass)) {
            throw new ModelContractError(`Factory "${plan.factoryName}" initializeWith must return an instance of ${ModelClass.name}, got: ${String(record)}`);
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const remaining = {};
        for (const key of Object.keys(publicAttributes)) {
            if (!consumed.has(key))
                remaining[key] = publicAttributes[key];
        }
        if (Object.keys(remaining).length > 0) {
            /** @type {ReturnType<typeof JSON.parse>} */ (record).assign(remaining);
        }
        return record;
    }
    /**
     * Wires evaluated associations onto a record through public relationship
     * reflection and generated setters (never private caches or guessed keys).
     * @param {ReturnType<typeof JSON.parse>} record - The owning record.
     * @param {Array<{name: string, record: ReturnType<typeof JSON.parse>}>} associations - Evaluated associations.
     * @returns {void}
     */
    _assignAssociations(record, associations) {
        for (const { name, record: associatedRecord } of associations) {
            const instanceRelationship = record.getRelationshipByName(name);
            const relationshipType = instanceRelationship.getType();
            if (relationshipType === "belongsTo") {
                record[`set${inflection.camelize(name)}`](associatedRecord || null);
            }
            else if (relationshipType === "hasOne") {
                instanceRelationship.setLoaded(associatedRecord || undefined);
            }
            else if (relationshipType === "hasMany") {
                instanceRelationship.setLoaded(this._toRecordArray(associatedRecord));
            }
        }
    }
    /**
     * Normalizes a has-many association value into an array of records.
     * @param {ReturnType<typeof JSON.parse>} value - Association value (record, array, or null).
     * @returns {Array<ReturnType<typeof JSON.parse>>} - The normalized record array.
     */
    _toRecordArray(value) {
        if (value == null)
            return [];
        if (Array.isArray(value))
            return value;
        return [value];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL2ZhY3Rvcnkvc3RyYXRlZ2llcy9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLEVBQUMsZ0JBQWdCLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQTtBQUNyRCxPQUFPLEVBQUMsa0JBQWtCLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDL0MsT0FBTyxpQkFBaUIsTUFBTSwwQkFBMEIsQ0FBQTtBQUV4RDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBWTtJQUMvQjs7Ozs7O09BTUc7SUFDSCxXQUFXLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxZQUFZO1FBQ3RDLE9BQU8sSUFBSSxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGdCQUFnQixDQUFDLE9BQU8sRUFBRSxVQUFVO1FBQ2xDLE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSztRQUM3QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUUzQyxJQUFJLENBQUMsU0FBUztZQUFFLE9BQU07UUFFdEIsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7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Q0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILG1CQUFtQixDQUFDLE1BQU0sRUFBRSxZQUFZO1FBQ3RDLEtBQUssTUFBTSxFQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUMsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUM1RCxNQUFNLG9CQUFvQixHQUFHLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUMvRCxNQUFNLGdCQUFnQixHQUFHLG9CQUFvQixDQUFDLE9BQU8sRUFBRSxDQUFBO1lBRXZELElBQUksZ0JBQWdCLEtBQUssV0FBVyxFQUFFLENBQUM7Z0JBQ3JDLE1BQU0sQ0FBQyxNQUFNLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLGdCQUFnQixJQUFJLElBQUksQ0FBQyxDQUFBO1lBQ3JFLENBQUM7aUJBQU0sSUFBSSxnQkFBZ0IsS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDekMsb0JBQW9CLENBQUMsU0FBUyxDQUFDLGdCQUFnQixJQUFJLFNBQVMsQ0FBQyxDQUFBO1lBQy9ELENBQUM7aUJBQU0sSUFBSSxnQkFBZ0IsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDMUMsb0JBQW9CLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFBO1lBQ3ZFLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxjQUFjLENBQUMsS0FBSztRQUNsQixJQUFJLEtBQUssSUFBSSxJQUFJO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFDNUIsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXRDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUNoQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQge2Fzc2VydE1vZGVsQ2xhc3N9IGZyb20gXCIuLi9tb2RlbC1jb250cmFjdC5qc1wiXG5pbXBvcnQge01vZGVsQ29udHJhY3RFcnJvcn0gZnJvbSBcIi4uL2Vycm9ycy5qc1wiXG5pbXBvcnQgRXZhbHVhdGlvbkNvbnRleHQgZnJvbSBcIi4uL2V2YWx1YXRpb24tY29udGV4dC5qc1wiXG5cbi8qKlxuICogU2hhcmVkIGJlaGF2aW91ciBmb3IgdGhlIGJ1aWxkL2NyZWF0ZS9hdHRyaWJ1dGVzRm9yIHN0cmF0ZWdpZXM6IGV2YWx1YXRpb25cbiAqIGNvbnRleHQgY3JlYXRpb24sIGRldGVybWluaXN0aWMgY2FsbGJhY2sgZXhlY3V0aW9uLCBndWFyYW50ZWVkIGBhZnRlckFsbGBcbiAqIGNsZWFudXAsIHJlY29yZCBjb25zdHJ1Y3Rpb24gKGRlZmF1bHQgYW5kIGBpbml0aWFsaXplV2l0aGApLCBhbmQgYXNzb2NpYXRpb25cbiAqIHdpcmluZyB0aHJvdWdoIHB1YmxpYyByZWxhdGlvbnNoaXAgcmVmbGVjdGlvbi5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFzZVN0cmF0ZWd5IHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYW4gZXZhbHVhdGlvbiBjb250ZXh0IGZvciBhIHBsYW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZmFjdG9yeS1yZWdpc3RyeS5qc1wiKS5kZWZhdWx0fSByZWdpc3RyeSAtIE93bmluZyByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IHBsYW4gLSBDb21waWxlZCBwbGFuLlxuICAgKiBAcGFyYW0ge1wiYXR0cmlidXRlc0ZvclwiIHwgXCJidWlsZFwiIHwgXCJjcmVhdGVcIn0gc3RyYXRlZ3lOYW1lIC0gU3RyYXRlZ3kgbmFtZS5cbiAgICogQHJldHVybnMge0V2YWx1YXRpb25Db250ZXh0fSAtIFRoZSBjb250ZXh0LlxuICAgKi9cbiAgX25ld0NvbnRleHQocmVnaXN0cnksIHBsYW4sIHN0cmF0ZWd5TmFtZSkge1xuICAgIHJldHVybiBuZXcgRXZhbHVhdGlvbkNvbnRleHQoe3JlZ2lzdHJ5LCBwbGFuLCBzdHJhdGVneTogc3RyYXRlZ3lOYW1lfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNhbGxiYWNrIGBjb250ZXh0YCBvYmplY3Q6IGV2YWx1YXRlZCB0cmFuc2llbnRzIGV4cG9zZWQgYXMgcGxhaW5cbiAgICogcHJvcGVydGllcyAobm8gUHJveHkpIHBsdXMgdGhlIG5hbWVkIGV2YWx1YXRvciBtZXRob2RzLlxuICAgKiBAcGFyYW0ge0V2YWx1YXRpb25Db250ZXh0fSBjb250ZXh0IC0gRXZhbHVhdGlvbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdHJhbnNpZW50cyAtIEV2YWx1YXRlZCB0cmFuc2llbnQgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBjYWxsYmFjayBjb250ZXh0LlxuICAgKi9cbiAgX2NhbGxiYWNrQ29udGV4dChjb250ZXh0LCB0cmFuc2llbnRzKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIHRyYW5zaWVudHMsIGNvbnRleHQuY29udGV4dEZvcihbXSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVyeSBkZWR1cGVkIGNhbGxiYWNrIGZvciBhbiBldmVudCBpbiBkZWNsYXJhdGlvbiBvcmRlci5cbiAgICogQHBhcmFtIHtFdmFsdWF0aW9uQ29udGV4dH0gY29udGV4dCAtIEV2YWx1YXRpb24gY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IHBsYW4gLSBDb21waWxlZCBwbGFuLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgLSBFdmVudCBuYW1lIChlLmcuIFwiYWZ0ZXJDcmVhdGVcIikuXG4gICAqIEBwYXJhbSB7e3JlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHRyYW5zaWVudHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3RyYXRlZ3k6IHN0cmluZ319IHN0YXRlIC0gQ3VycmVudCByZWNvcmQvdHJhbnNpZW50cy9zdHJhdGVneS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgY2FsbGJhY2tzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3J1bkNhbGxiYWNrcyhjb250ZXh0LCBwbGFuLCBldmVudCwgc3RhdGUpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSBwbGFuLmNhbGxiYWNrcy5nZXQoZXZlbnQpXG5cbiAgICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuXG5cbiAgICBjb25zdCBjYWxsYmFja0NvbnRleHQgPSB0aGlzLl9jYWxsYmFja0NvbnRleHQoY29udGV4dCwgc3RhdGUudHJhbnNpZW50cylcblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY2FsbGJhY2tzKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjay5mbih7cmVjb3JkOiBzdGF0ZS5yZWNvcmQsIGNvbnRleHQ6IGNhbGxiYWNrQ29udGV4dCwgc3RyYXRlZ3k6IHN0YXRlLnN0cmF0ZWd5fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBgYm9keWAsIHRoZW4gZ3VhcmFudGVlcyBgYWZ0ZXJBbGxgIHJ1bnMgaW4gYGZpbmFsbHlgLiBXaGVuIGJvdGggdGhlIGJvZHlcbiAgICogYW5kIGNsZWFudXAgZmFpbCwgdGhlIGJvZHkncyBwcmltYXJ5IGVycm9yIGlzIHByZXNlcnZlZCBhbmQgdGhlIGNsZWFudXAgZXJyb3JcbiAgICogaXMgYXR0YWNoZWQgYXMgYSBkZXRhaWwgcmF0aGVyIHRoYW4gbWFza2luZyBpdC5cbiAgICogQHBhcmFtIHtFdmFsdWF0aW9uQ29udGV4dH0gY29udGV4dCAtIEV2YWx1YXRpb24gY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IHBsYW4gLSBDb21waWxlZCBwbGFuLlxuICAgKiBAcGFyYW0geygpID0+IHtyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0cmFuc2llbnRzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN0cmF0ZWd5OiBzdHJpbmd9fSBzdGF0ZSAtIExhdGUtYm91bmQgc3RhdGUgYWNjZXNzb3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJvZHkgLSBUaGUgc3RyYXRlZ3kgYm9keS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBib2R5J3MgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1bldpdGhBZnRlckFsbChjb250ZXh0LCBwbGFuLCBzdGF0ZSwgYm9keSkge1xuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgbGV0IHJlc3VsdFxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgbGV0IHByaW1hcnlFcnJvclxuICAgIGxldCBoYXNQcmltYXJ5RXJyb3IgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGJvZHkoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBwcmltYXJ5RXJyb3IgPSBlcnJvclxuICAgICAgaGFzUHJpbWFyeUVycm9yID0gdHJ1ZVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgbGV0IGNsZWFudXBFcnJvclxuICAgIGxldCBoYXNDbGVhbnVwRXJyb3IgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkNhbGxiYWNrcyhjb250ZXh0LCBwbGFuLCBcImFmdGVyQWxsXCIsIHN0YXRlKCkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNsZWFudXBFcnJvciA9IGVycm9yXG4gICAgICBoYXNDbGVhbnVwRXJyb3IgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGhhc1ByaW1hcnlFcnJvcikge1xuICAgICAgaWYgKGhhc0NsZWFudXBFcnJvcikgdGhpcy5fYXR0YWNoQ2xlYW51cEZhaWx1cmUocHJpbWFyeUVycm9yLCBjbGVhbnVwRXJyb3IpXG5cbiAgICAgIHRocm93IHByaW1hcnlFcnJvclxuICAgIH1cblxuICAgIGlmIChoYXNDbGVhbnVwRXJyb3IpIHRocm93IGNsZWFudXBFcnJvclxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaGVzIGFuIGFmdGVyQWxsIGNsZWFudXAgZmFpbHVyZSB0byB0aGUgcHJpbWFyeSBlcnJvciB3aXRob3V0IG1hc2tpbmcgaXQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHByaW1hcnlFcnJvciAtIFRoZSBvcmlnaW5hbCBlcnJvciB0aGF0IHdpbGwgcHJvcGFnYXRlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjbGVhbnVwRXJyb3IgLSBUaGUgYWZ0ZXJBbGwgY2xlYW51cCBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hdHRhY2hDbGVhbnVwRmFpbHVyZShwcmltYXJ5RXJyb3IsIGNsZWFudXBFcnJvcikge1xuICAgIGlmICghcHJpbWFyeUVycm9yIHx8IHR5cGVvZiBwcmltYXJ5RXJyb3IgIT09IFwib2JqZWN0XCIgfHwgIU9iamVjdC5pc0V4dGVuc2libGUocHJpbWFyeUVycm9yKSkgcmV0dXJuXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocHJpbWFyeUVycm9yLmZhY3RvcnlDbGVhbnVwRXJyb3JzKSkgcHJpbWFyeUVycm9yLmZhY3RvcnlDbGVhbnVwRXJyb3JzID0gW11cbiAgICBwcmltYXJ5RXJyb3IuZmFjdG9yeUNsZWFudXBFcnJvcnMucHVzaChjbGVhbnVwRXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogQ29uc3RydWN0cyBhIHJlY29yZCBmcm9tIGV2YWx1YXRlZCBwdWJsaWMgYXR0cmlidXRlcywgaG9ub3VyaW5nIGEgY3VzdG9tXG4gICAqIGBpbml0aWFsaXplV2l0aGAgY29uc3RydWN0b3IgYW5kIG5ldmVyIGFzc2lnbmluZyBjb25zdHJ1Y3Rvci1jb25zdW1lZFxuICAgKiBhdHRyaWJ1dGVzIHR3aWNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2ZhY3RvcnktcnVubmVyLmpzXCIpLkNvbXBpbGVkUGxhbn0gcGxhbiAtIENvbXBpbGVkIHBsYW4uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwdWJsaWNBdHRyaWJ1dGVzIC0gRXZhbHVhdGVkIHB1YmxpYyBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0V2YWx1YXRpb25Db250ZXh0fSBjb250ZXh0IC0gRXZhbHVhdGlvbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdHJhbnNpZW50cyAtIEV2YWx1YXRlZCB0cmFuc2llbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGNvbnN0cnVjdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9jb25zdHJ1Y3RSZWNvcmQocGxhbiwgcHVibGljQXR0cmlidXRlcywgY29udGV4dCwgdHJhbnNpZW50cykge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBhc3NlcnRNb2RlbENsYXNzKHBsYW4ubW9kZWxDbGFzcywgcGxhbi5mYWN0b3J5TmFtZSlcblxuICAgIGlmIChwbGFuLmluaXRpYWxpemVXaXRoKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uc3RydWN0V2l0aEluaXRpYWxpemVyKHBsYW4sIE1vZGVsQ2xhc3MsIHB1YmxpY0F0dHJpYnV0ZXMsIGNvbnRleHQsIHRyYW5zaWVudHMpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBNb2RlbENsYXNzKHB1YmxpY0F0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogQ29uc3RydWN0cyBhIHJlY29yZCB2aWEgYSBjdXN0b20gYGluaXRpYWxpemVXaXRoYCwgdHJhY2tpbmcgd2hpY2ggYXR0cmlidXRlc1xuICAgKiB0aGUgY29uc3RydWN0b3IgY29uc3VtZWQgdGhyb3VnaCBpdHMgYGdldChuYW1lKWAgYWNjZXNzb3IgYW5kIGFzc2lnbmluZyBvbmx5XG4gICAqIHRoZSByZW1haW5pbmcgcHVibGljIGF0dHJpYnV0ZXMgYWZ0ZXJ3YXJkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IHBsYW4gLSBDb21waWxlZCBwbGFuLlxuICAgKiBAcGFyYW0ge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi4vLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IE1vZGVsQ2xhc3MgLSBWYWxpZGF0ZWQgZGVjbGFyZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwdWJsaWNBdHRyaWJ1dGVzIC0gRXZhbHVhdGVkIHB1YmxpYyBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0V2YWx1YXRpb25Db250ZXh0fSBjb250ZXh0IC0gRXZhbHVhdGlvbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdHJhbnNpZW50cyAtIEV2YWx1YXRlZCB0cmFuc2llbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGNvbnN0cnVjdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9jb25zdHJ1Y3RXaXRoSW5pdGlhbGl6ZXIocGxhbiwgTW9kZWxDbGFzcywgcHVibGljQXR0cmlidXRlcywgY29udGV4dCwgdHJhbnNpZW50cykge1xuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgY29uc3VtZWQgPSBuZXcgU2V0KClcbiAgICBjb25zdCBnZXQgPSAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIG5hbWUpID0+IHtcbiAgICAgIGNvbnN1bWVkLmFkZChuYW1lKVxuXG4gICAgICByZXR1cm4gcHVibGljQXR0cmlidXRlc1tuYW1lXVxuICAgIH1cbiAgICBjb25zdCBpbml0aWFsaXplV2l0aCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGVjbGFyYXRpb25zLmpzXCIpLkluaXRpYWxpemVXaXRoRGVjbGFyYXRpb25bXCJmblwiXX0gKi8gKHBsYW4uaW5pdGlhbGl6ZVdpdGgpXG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgaW5pdGlhbGl6ZVdpdGgoe2F0dHJpYnV0ZXM6IHsuLi5wdWJsaWNBdHRyaWJ1dGVzfSwgZ2V0LCBjb250ZXh0OiB0aGlzLl9jYWxsYmFja0NvbnRleHQoY29udGV4dCwgdHJhbnNpZW50cyl9KVxuXG4gICAgaWYgKCEocmVjb3JkIGluc3RhbmNlb2YgTW9kZWxDbGFzcykpIHtcbiAgICAgIHRocm93IG5ldyBNb2RlbENvbnRyYWN0RXJyb3IoYEZhY3RvcnkgXCIke3BsYW4uZmFjdG9yeU5hbWV9XCIgaW5pdGlhbGl6ZVdpdGggbXVzdCByZXR1cm4gYW4gaW5zdGFuY2Ugb2YgJHtNb2RlbENsYXNzLm5hbWV9LCBnb3Q6ICR7U3RyaW5nKHJlY29yZCl9YClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZW1haW5pbmcgPSB7fVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocHVibGljQXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghY29uc3VtZWQuaGFzKGtleSkpIHJlbWFpbmluZ1trZXldID0gcHVibGljQXR0cmlidXRlc1trZXldXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlbWFpbmluZykubGVuZ3RoID4gMCkge1xuICAgICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlY29yZCkuYXNzaWduKHJlbWFpbmluZylcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogV2lyZXMgZXZhbHVhdGVkIGFzc29jaWF0aW9ucyBvbnRvIGEgcmVjb3JkIHRocm91Z2ggcHVibGljIHJlbGF0aW9uc2hpcFxuICAgKiByZWZsZWN0aW9uIGFuZCBnZW5lcmF0ZWQgc2V0dGVycyAobmV2ZXIgcHJpdmF0ZSBjYWNoZXMgb3IgZ3Vlc3NlZCBrZXlzKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gVGhlIG93bmluZyByZWNvcmQuXG4gICAqIEBwYXJhbSB7QXJyYXk8e25hbWU6IHN0cmluZywgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBhc3NvY2lhdGlvbnMgLSBFdmFsdWF0ZWQgYXNzb2NpYXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hc3NpZ25Bc3NvY2lhdGlvbnMocmVjb3JkLCBhc3NvY2lhdGlvbnMpIHtcbiAgICBmb3IgKGNvbnN0IHtuYW1lLCByZWNvcmQ6IGFzc29jaWF0ZWRSZWNvcmR9IG9mIGFzc29jaWF0aW9ucykge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKG5hbWUpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIHJlY29yZFtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpfWBdKGFzc29jaWF0ZWRSZWNvcmQgfHwgbnVsbClcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwVHlwZSA9PT0gXCJoYXNPbmVcIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRMb2FkZWQoYXNzb2NpYXRlZFJlY29yZCB8fCB1bmRlZmluZWQpXG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZCh0aGlzLl90b1JlY29yZEFycmF5KGFzc29jaWF0ZWRSZWNvcmQpKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgaGFzLW1hbnkgYXNzb2NpYXRpb24gdmFsdWUgaW50byBhbiBhcnJheSBvZiByZWNvcmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEFzc29jaWF0aW9uIHZhbHVlIChyZWNvcmQsIGFycmF5LCBvciBudWxsKS5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgbm9ybWFsaXplZCByZWNvcmQgYXJyYXkuXG4gICAqL1xuICBfdG9SZWNvcmRBcnJheSh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gICAgcmV0dXJuIFt2YWx1ZV1cbiAgfVxufVxuIl19