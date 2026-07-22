// @ts-check

import BaseStrategy from "./base.js"

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
   * @returns {Promise<?>} - The persisted record.
   */
  async run({registry, plan}) {
    const context = this._newContext(registry, plan, "create")
    /** @type {{record: ?, transients: Record<string, ?>}} */
    const runState = {record: undefined, transients: {}}
    const state = () => ({record: runState.record, transients: runState.transients, strategy: "create"})

    return await this._runWithAfterAll(context, plan, state, async () => {
      runState.transients = await context.resolveTransients()

      await this._runCallbacks(context, plan, "beforeAll", state())
      await this._runCallbacks(context, plan, "beforeBuild", state())

      const {publicAttributes, transients, associations} = await context.resolveForConstruction()

      const record = await this._constructRecord(plan, publicAttributes, context, transients)

      this._assignAssociations(record, associations)
      runState.record = record

      await this._runCallbacks(context, plan, "afterBuild", state())
      await this._runCallbacks(context, plan, "beforeCreate", state())
      await this._persist(plan, record, context, transients)
      await this._runCallbacks(context, plan, "afterCreate", state())

      return record
    })
  }

  /**
   * Persists the record via a custom `toCreate`, native `save()`, or not at all
   * when `skipCreate` is declared.
   * @param {import("../factory-runner.js").CompiledPlan} plan - Compiled plan.
   * @param {?} record - The record to persist.
   * @param {import("../evaluation-context.js").default} context - Evaluation context.
   * @param {Record<string, ?>} transients - Evaluated transients.
   * @returns {Promise<void>} - Resolves when persistence completes.
   */
  async _persist(plan, record, context, transients) {
    if (plan.skipCreate) return

    if (plan.toCreate) {
      await plan.toCreate({record, context: this._callbackContext(context, transients)})

      return
    }

    await record.save()
  }
}
