// @ts-check

import * as inflection from "inflection"
import {assertModelClass} from "../model-contract.js"
import {ModelContractError} from "../errors.js"
import EvaluationContext from "../evaluation-context.js"

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
    return new EvaluationContext({registry, plan, strategy: strategyName})
  }

  /**
   * Builds the callback `context` object: evaluated transients exposed as plain
   * properties (no Proxy) plus the named evaluator methods.
   * @param {EvaluationContext} context - Evaluation context.
   * @param {Record<string, ?>} transients - Evaluated transient values.
   * @returns {Record<string, ?>} - The callback context.
   */
  _callbackContext(context, transients) {
    return Object.assign({}, transients, context.contextFor([]))
  }

  /**
   * Runs every deduped callback for an event in declaration order.
   * @param {EvaluationContext} context - Evaluation context.
   * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
   * @param {string} event - Event name (e.g. "afterCreate").
   * @param {{record: ?, transients: Record<string, ?>, strategy: string}} state - Current record/transients/strategy.
   * @returns {Promise<void>} - Resolves when all callbacks complete.
   */
  async _runCallbacks(context, plan, event, state) {
    const callbacks = plan.callbacks.get(event)

    if (!callbacks) return

    const callbackContext = this._callbackContext(context, state.transients)

    for (const callback of callbacks) {
      await callback.fn({record: state.record, context: callbackContext, strategy: state.strategy})
    }
  }

  /**
   * Runs `body`, then guarantees `afterAll` runs in `finally`. When both the body
   * and cleanup fail, the body's primary error is preserved and the cleanup error
   * is attached as a detail rather than masking it.
   * @param {EvaluationContext} context - Evaluation context.
   * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
   * @param {() => {record: ?, transients: Record<string, ?>, strategy: string}} state - Late-bound state accessor.
   * @param {() => Promise<?>} body - The strategy body.
   * @returns {Promise<?>} - The body's result.
   */
  async _runWithAfterAll(context, plan, state, body) {
    /** @type {?} */
    let result
    /** @type {?} */
    let primaryError
    let hasPrimaryError = false

    try {
      result = await body()
    } catch (error) {
      primaryError = error
      hasPrimaryError = true
    }

    /** @type {?} */
    let cleanupError
    let hasCleanupError = false

    try {
      await this._runCallbacks(context, plan, "afterAll", state())
    } catch (error) {
      cleanupError = error
      hasCleanupError = true
    }

    if (hasPrimaryError) {
      if (hasCleanupError) this._attachCleanupFailure(primaryError, cleanupError)

      throw primaryError
    }

    if (hasCleanupError) throw cleanupError

    return result
  }

  /**
   * Attaches an afterAll cleanup failure to the primary error without masking it.
   * @param {?} primaryError - The original error that will propagate.
   * @param {?} cleanupError - The afterAll cleanup failure.
   * @returns {void}
   */
  _attachCleanupFailure(primaryError, cleanupError) {
    if (primaryError && typeof primaryError === "object") {
      if (!Array.isArray(primaryError.factoryCleanupErrors)) primaryError.factoryCleanupErrors = []
      primaryError.factoryCleanupErrors.push(cleanupError)
    }
  }

  /**
   * Constructs a record from evaluated public attributes, honouring a custom
   * `initializeWith` constructor and never assigning constructor-consumed
   * attributes twice.
   * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
   * @param {Record<string, ?>} publicAttributes - Evaluated public attributes.
   * @param {EvaluationContext} context - Evaluation context.
   * @param {Record<string, ?>} transients - Evaluated transients.
   * @returns {Promise<?>} - The constructed record.
   */
  async _constructRecord(plan, publicAttributes, context, transients) {
    if (plan.initializeWith) {
      return await this._constructWithInitializer(plan, publicAttributes, context, transients)
    }

    const ModelClass = assertModelClass(plan.modelClass, plan.factoryName)

    return new ModelClass(publicAttributes)
  }

  /**
   * Constructs a record via a custom `initializeWith`, tracking which attributes
   * the constructor consumed through its `get(name)` accessor and assigning only
   * the remaining public attributes afterwards.
   * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
   * @param {Record<string, ?>} publicAttributes - Evaluated public attributes.
   * @param {EvaluationContext} context - Evaluation context.
   * @param {Record<string, ?>} transients - Evaluated transients.
   * @returns {Promise<?>} - The constructed record.
   */
  async _constructWithInitializer(plan, publicAttributes, context, transients) {
    /** @type {Set<string>} */
    const consumed = new Set()
    const get = (/** @type {string} */ name) => {
      consumed.add(name)

      return publicAttributes[name]
    }
    const initializeWith = /** @type {import("../declarations.js").InitializeWithDeclaration["fn"]} */ (plan.initializeWith)
    const record = await initializeWith({attributes: {...publicAttributes}, get, context: this._callbackContext(context, transients)})

    if (!record || (typeof record !== "object" && typeof record !== "function")) {
      throw new ModelContractError(`Factory "${plan.factoryName}" initializeWith must return a record instance, got: ${String(record)}`)
    }

    /** @type {Record<string, ?>} */
    const remaining = {}

    for (const key of Object.keys(publicAttributes)) {
      if (!consumed.has(key)) remaining[key] = publicAttributes[key]
    }

    if (Object.keys(remaining).length > 0) {
      /** @type {?} */ (record).assign(remaining)
    }

    return record
  }

  /**
   * Wires evaluated associations onto a record through public relationship
   * reflection and generated setters (never private caches or guessed keys).
   * @param {?} record - The owning record.
   * @param {Array<{name: string, record: ?}>} associations - Evaluated associations.
   * @returns {void}
   */
  _assignAssociations(record, associations) {
    for (const {name, record: associatedRecord} of associations) {
      const instanceRelationship = record.getRelationshipByName(name)
      const relationshipType = instanceRelationship.getType()

      if (relationshipType === "belongsTo") {
        record[`set${inflection.camelize(name)}`](associatedRecord || null)
      } else if (relationshipType === "hasOne") {
        instanceRelationship.setLoaded(associatedRecord || undefined)
      } else if (relationshipType === "hasMany") {
        instanceRelationship.setLoaded(this._toRecordArray(associatedRecord))
      }
    }
  }

  /**
   * Normalizes a has-many association value into an array of records.
   * @param {?} value - Association value (record, array, or null).
   * @returns {Array<?>} - The normalized record array.
   */
  _toRecordArray(value) {
    if (value == null) return []
    if (Array.isArray(value)) return value

    return [value]
  }
}
