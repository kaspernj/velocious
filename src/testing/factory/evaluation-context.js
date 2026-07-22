// @ts-check

import {FactoryCycleError, UndefinedAttributeError} from "./errors.js"

/**
 * A single factory run's evaluation state. It resolves attributes/transients/
 * associations lazily and memoizes each name exactly once per run (sharing an
 * in-flight promise between concurrent dependents). Cycle detection uses a
 * per-chain path so genuine recursion is reported while concurrent sibling reads
 * of the same name are allowed.
 */
export default class EvaluationContext {
  /**
   * Builds an evaluation context.
   * @param {object} args - Options.
   * @param {import("./factory-registry.js").default} args.registry - Owning registry.
   * @param {import("./factory-runner.js").CompiledPlan} args.plan - Compiled run plan.
   * @param {"attributesFor" | "build" | "create"} args.strategy - Active strategy.
   */
  constructor({registry, plan, strategy}) {
    /** @type {import("./factory-registry.js").default} - Owning registry. */
    this.registry = registry

    /** @type {import("./factory-runner.js").CompiledPlan} - Compiled run plan. */
    this.plan = plan

    /** @type {"attributesFor" | "build" | "create"} - Active strategy. */
    this.strategy = strategy

    /** @type {Map<string, ?>} - Per-run memoized values / in-flight promises. */
    this._memo = new Map()
  }

  /**
   * Builds the named evaluator context handed to lazy values and callbacks for a
   * given dependency path.
   * @param {string[]} path - Current resolution path (for cycle detection).
   * @returns {{get: (name: string) => Promise<?>, generate: (name: string) => Promise<?>, association: (factory: string, ...args: Array<?>) => Promise<?>}} - The evaluator context.
   */
  contextFor(path) {
    return {
      get: (name) => this._get(name, path),
      generate: (name) => this.registry._generateScoped(name, this.plan.chainNames),
      association: (factory, ...args) => this._explicitAssociation(factory, args, path)
    }
  }

  /**
   * Resolves an attribute/transient/association by name, memoizing the result.
   * @param {string} name - Name to resolve.
   * @param {string[]} path - Current resolution path.
   * @returns {Promise<?>} - The resolved value.
   */
  _get(name, path) {
    if (path.includes(name)) {
      throw new FactoryCycleError(`Attribute dependency cycle detected: ${[...path, name].join(" -> ")}`)
    }

    if (this._memo.has(name)) return this._memo.get(name)

    const slot = this.plan.resolved.get(name)

    if (!slot) {
      throw new UndefinedAttributeError(`Unknown attribute "${name}" referenced while evaluating factory "${this.plan.factoryName}"`)
    }

    const promise = this._evaluateSlot(slot, [...path, name])

    this._memo.set(name, promise)
    promise.then((value) => this._memo.set(name, value), () => {})

    return promise
  }

  /**
   * Evaluates a resolved slot, honouring lazy functions and overrides.
   * @param {import("./factory-runner.js").Slot} slot - Slot to evaluate.
   * @param {string[]} childPath - Path including this slot's name.
   * @returns {Promise<?>} - The evaluated value.
   */
  async _evaluateSlot(slot, childPath) {
    if (slot.slotKind === "association") {
      return await this._resolveAssociationSlot(slot)
    }

    if (typeof slot.value === "function" && !slot.isOverride) {
      return await slot.value(this.contextFor(childPath))
    }

    return slot.value
  }

  /**
   * Resolves a declared/overridden association slot. An explicit object/null
   * override suppresses nested factory execution and is returned verbatim.
   * @param {import("./factory-runner.js").Slot} slot - Association slot.
   * @returns {Promise<?>} - The associated record (or override value).
   */
  async _resolveAssociationSlot(slot) {
    if (slot.isOverride) return slot.value

    if (this.strategy === "attributesFor") return null

    const declaration = /** @type {import("./association-declaration.js").default} */ (slot.value)
    const associationStrategy = declaration.strategy || (this.strategy === "create" ? "build" : this.strategy)

    return await this.registry._runFactory({
      factoryName: declaration.factory,
      traits: declaration.traits,
      overrides: declaration.overrides,
      strategy: /** @type {"build" | "create"} */ (associationStrategy)
    })
  }

  /**
   * Runs an explicitly-invoked association from a lazy value's `association(...)`.
   * @param {string} factoryName - Factory to run.
   * @param {Array<?>} args - Traits and/or an overrides object.
   * @param {string[]} _path - Current resolution path (unused; associations open a fresh run).
   * @returns {Promise<?>} - The associated record, or null under attributesFor.
   */
  _explicitAssociation(factoryName, args, _path) {
    if (this.strategy === "attributesFor") return Promise.resolve(null)

    /** @type {string[]} */
    const traits = []
    /** @type {Record<string, ?>} */
    let overrides = {}

    for (const arg of args) {
      if (typeof arg === "string") traits.push(arg)
      else if (arg && typeof arg === "object") overrides = arg
    }

    const associationStrategy = this.strategy === "create" ? "build" : this.strategy

    return this.registry._runFactory({factoryName, traits, overrides, strategy: associationStrategy})
  }

  /**
   * Resolves every plain attribute slot (used by attributesFor). Transients and
   * associations are omitted, though transients may still be evaluated on demand
   * as dependencies.
   * @returns {Promise<Record<string, ?>>} - The resolved attributes.
   */
  async resolveAttributes() {
    /** @type {Record<string, ?>} */
    const attributes = {}

    for (const [name, slot] of this.plan.resolved) {
      if (slot.slotKind === "attribute") {
        attributes[name] = await this._get(name, [])
      }
    }

    return attributes
  }

  /**
   * Resolves every transient before callbacks that expose them as plain properties.
   * @returns {Promise<Record<string, ?>>} - Evaluated transient values.
   */
  async resolveTransients() {
    /** @type {Record<string, ?>} */
    const transients = {}

    for (const [name, slot] of this.plan.resolved) {
      if (slot.slotKind === "transient") transients[name] = await this._get(name, [])
    }

    return transients
  }

  /**
   * Resolves everything needed to construct a record: public attributes,
   * transients, and associated records.
   * @returns {Promise<{publicAttributes: Record<string, ?>, transients: Record<string, ?>, associations: Array<{name: string, record: ?}>}>} - Resolved construction inputs.
   */
  async resolveForConstruction() {
    /** @type {Record<string, ?>} */
    const publicAttributes = {}
    /** @type {Record<string, ?>} */
    const transients = {}
    /** @type {Array<{name: string, record: ?}>} */
    const associations = []

    for (const [name, slot] of this.plan.resolved) {
      if (slot.slotKind === "attribute") {
        publicAttributes[name] = await this._get(name, [])
      } else if (slot.slotKind === "transient") {
        transients[name] = await this._get(name, [])
      } else if (slot.slotKind === "association") {
        associations.push({name, record: await this._get(name, [])})
      }
    }

    return {publicAttributes, transients, associations}
  }
}
