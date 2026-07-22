// @ts-check

import BaseStrategy from "./base.js"

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
   * @returns {Promise<Record<string, ?>>} - The resolved attributes.
   */
  async run({registry, plan}) {
    const context = this._newContext(registry, plan, "attributesFor")

    return await context.resolveAttributes()
  }
}
