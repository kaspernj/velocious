// @ts-check

import BaseStrategy from "./base.js"

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
   * @returns {Promise<?>} - The built (unsaved) record.
   */
  async run({registry, plan}) {
    const context = this._newContext(registry, plan, "build")
    /** @type {{record: ?, transients: Record<string, ?>}} */
    const runState = {record: undefined, transients: {}}
    const state = () => ({record: runState.record, transients: runState.transients, strategy: "build"})

    return await this._runWithAfterAll(context, plan, state, async () => {
      runState.transients = await context.resolveTransients()

      await this._runCallbacks(context, plan, "beforeAll", state())
      await this._runCallbacks(context, plan, "beforeBuild", state())

      const {publicAttributes, transients, associations} = await context.resolveForConstruction()

      const record = await this._constructRecord(plan, publicAttributes, context, transients)

      this._assignAssociations(record, associations)
      runState.record = record

      await this._runCallbacks(context, plan, "afterBuild", state())

      return record
    })
  }
}
