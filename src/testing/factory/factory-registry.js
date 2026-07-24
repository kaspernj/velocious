// @ts-check

import {DuplicateDefinitionError, RegistryBusyError, UndefinedSequenceError} from "./errors.js"
import AttributesForStrategy from "./strategies/attributes-for.js"
import BuildStrategy from "./strategies/build.js"
import CreateStrategy from "./strategies/create.js"
import DefinitionSession from "./definition-builder.js"
import FactoryEventEmitter from "./events.js"
import FactoryLinter from "./linter.js"
import FactoryRunner from "./factory-runner.js"
import {isPlainObject} from "is-plain-object"

/**
 * Normalizes a strategy invocation's variadic tail into ordered trait names plus
 * a single final overrides object (`strategy(name, ...traits, overrides?)`).
 * @param {Array<?>} args - Arguments after the factory name (and count for lists).
 * @returns {{traits: string[], overrides: Record<string, ?>}} - Normalized invocation.
 */
function normalizeInvocationArgs(args) {
  /** @type {string[]} */
  const traits = []
  /** @type {Record<string, ?>} */
  let overrides = {}
  let sawOverrides = false

  for (const arg of args) {
    if (typeof arg === "string" && !sawOverrides) {
      traits.push(arg)
    } else if (isPlainObject(arg) && !sawOverrides) {
      overrides = arg
      sawOverrides = true
    } else if (arg !== undefined) {
      throw new TypeError(`Invalid factory invocation argument: ${String(arg)}. Expected trait names then a single final overrides object.`)
    }
  }

  return {traits, overrides}
}

/**
 * Owns all factories, traits, sequences, callbacks and construction defaults for
 * one isolated scope, and exposes the strategy entry points. Registry mutation is
 * setup-time only and is rejected while evaluations are active.
 */
export default class FactoryRegistry {
  /** Builds an empty registry with the built-in strategies installed. */
  constructor() {
    /** @type {Map<string, import("./factory-definition.js").default>} - Factories and aliases. */
    this._factories = new Map()

    /** @type {Map<string, import("./trait-definition.js").default>} - Global traits. */
    this._globalTraits = new Map()

    /** @type {Map<string, import("./sequence.js").default>} - Global sequences and aliases. */
    this._sequences = new Map()

    /** @type {Map<string, Map<string, import("./sequence.js").default>>} - Factory-scoped sequences. */
    this._factorySequences = new Map()

    /** @type {import("./declarations.js").Declaration[]} - Registry-level default declarations. */
    this._globalDeclarations = []

    /** @type {number} - In-flight evaluation count (mutation guard). */
    this._activeEvaluations = 0

    /** @type {FactoryRunner} - Plan compiler. */
    this._runner = new FactoryRunner(this)

    /** @type {FactoryEventEmitter} - Debug/performance event emitter. */
    this._events = new FactoryEventEmitter()

    /** @type {{attributesFor: AttributesForStrategy, build: BuildStrategy, create: CreateStrategy}} - Installed strategies. */
    this._strategies = {
      attributesFor: new AttributesForStrategy(),
      build: new BuildStrategy(),
      create: new CreateStrategy()
    }
  }

  /**
   * Registers factories/traits/sequences/callbacks via a builder callback.
   * @param {(builder: object) => void} callback - The definition callback.
   * @returns {this} - This registry (for chaining).
   */
  define(callback) {
    this._assertNotEvaluating("define")
    new DefinitionSession(this).run(callback)

    return this
  }

  /**
   * Reopens existing factories to append/override declarations, recompiling each
   * into a fresh immutable definition. Rejected while evaluations are active.
   * @param {(builder: object) => void} callback - The modify callback.
   * @returns {this} - This registry (for chaining).
   */
  modify(callback) {
    this._assertNotEvaluating("modify")
    new DefinitionSession(this).runModify(callback)

    return this
  }

  /**
   * Lints factories/traits, aggregating every failure. Create-strategy cases roll
   * back their database writes.
   * @param {object} [options] - Lint options (factories, traits, strategy).
   * @returns {Promise<void>} - Resolves when all cases pass; rejects with an aggregate otherwise.
   */
  async lint(options) {
    return await new FactoryLinter(this).lint(options)
  }

  /**
   * Subscribes to factory debug events (`start`, `success`, `failure`).
   * @param {string} event - Event name.
   * @param {(payload: {invocationId: string, factory: string, strategy: string, traits: string[], durationMs?: number, error?: ?}) => void} handler - Event handler.
   * @returns {this} - This registry (for chaining).
   */
  on(event, handler) {
    this._events.on(event, handler)

    return this
  }

  /**
   * Unsubscribes a previously-registered event handler.
   * @param {string} event - Event name.
   * @param {(payload: ?) => void} handler - Event handler to remove.
   * @returns {this} - This registry (for chaining).
   */
  off(event, handler) {
    this._events.off(event, handler)

    return this
  }

  /**
   * Resolves attributes without constructing a model or building associations.
   * @param {string} factoryName - Factory name.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Record<string, ?>>} - The resolved attributes.
   */
  async attributesFor(factoryName, ...args) {
    const {traits, overrides} = normalizeInvocationArgs(args)

    return await this._runFactory({factoryName, traits, overrides, strategy: "attributesFor"})
  }

  /**
   * Builds an unsaved record graph.
   * @param {string} factoryName - Factory name.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<?>} - The built record.
   */
  async build(factoryName, ...args) {
    const {traits, overrides} = normalizeInvocationArgs(args)

    return await this._runFactory({factoryName, traits, overrides, strategy: "build"})
  }

  /**
   * Builds and persists a record graph.
   * @param {string} factoryName - Factory name.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<?>} - The persisted record.
   */
  async create(factoryName, ...args) {
    const {traits, overrides} = normalizeInvocationArgs(args)

    return await this._runFactory({factoryName, traits, overrides, strategy: "create"})
  }

  /**
   * Resolves attributes for a list of records sequentially.
   * @param {string} factoryName - Factory name.
   * @param {number} count - Number of entries.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<Record<string, ?>>>} - The resolved attribute objects.
   */
  async attributesForList(factoryName, count, ...args) {
    return await this._runList("attributesFor", factoryName, count, args)
  }

  /**
   * Builds a list of unsaved records sequentially.
   * @param {string} factoryName - Factory name.
   * @param {number} count - Number of records.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<?>>} - The built records.
   */
  async buildList(factoryName, count, ...args) {
    return await this._runList("build", factoryName, count, args)
  }

  /**
   * Creates a list of persisted records sequentially.
   * @param {string} factoryName - Factory name.
   * @param {number} count - Number of records.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<?>>} - The persisted records.
   */
  async createList(factoryName, count, ...args) {
    return await this._runList("create", factoryName, count, args)
  }

  /**
   * Resolves attributes for exactly two records.
   * @param {string} factoryName - Factory name.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<Record<string, ?>>>} - The two resolved attribute objects.
   */
  async attributesForPair(factoryName, ...args) {
    return await this._runList("attributesFor", factoryName, 2, args)
  }

  /**
   * Builds exactly two unsaved records.
   * @param {string} factoryName - Factory name.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<?>>} - The two built records.
   */
  async buildPair(factoryName, ...args) {
    return await this._runList("build", factoryName, 2, args)
  }

  /**
   * Creates exactly two persisted records.
   * @param {string} factoryName - Factory name.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<?>>} - The two persisted records.
   */
  async createPair(factoryName, ...args) {
    return await this._runList("create", factoryName, 2, args)
  }

  /**
   * Advances a sequence and returns its formatted value.
   * @param {string} sequenceName - Sequence name.
   * @returns {Promise<?>} - The formatted value.
   */
  async generate(sequenceName) {
    return await this._generateScoped(sequenceName, [])
  }

  /**
   * Advances a sequence `count` times and returns the formatted values.
   * @param {string} sequenceName - Sequence name.
   * @param {number} count - Number of values.
   * @returns {Promise<Array<?>>} - The formatted values.
   */
  async generateList(sequenceName, count) {
    /** @type {Array<?>} */
    const values = []

    for (let index = 0; index < count; index++) {
      values.push(await this._generateScoped(sequenceName, []))
    }

    return values
  }

  /**
   * Returns the next raw value a global sequence would allocate without consuming it.
   * @param {string} sequenceName - Sequence name.
   * @returns {number} - The upcoming raw value.
   */
  peekSequence(sequenceName) {
    return this._resolveGlobalSequence(sequenceName).peek()
  }

  /**
   * Sets the next value a global sequence will allocate.
   * @param {string} sequenceName - Sequence name.
   * @param {number} value - Next raw value.
   * @returns {void}
   */
  setSequence(sequenceName, value) {
    this._assertNotEvaluating("setSequence")
    this._resolveGlobalSequence(sequenceName).set(value)
  }

  /**
   * Rewinds a single global sequence to its initial value.
   * @param {string} sequenceName - Sequence name.
   * @returns {void}
   */
  rewindSequence(sequenceName) {
    this._assertNotEvaluating("rewindSequence")
    this._resolveGlobalSequence(sequenceName).rewind()
  }

  /**
   * Rewinds every global and factory-scoped sequence to its initial value while
   * leaving all definitions intact.
   * @returns {void}
   */
  rewindSequences() {
    this._assertNotEvaluating("rewindSequences")

    for (const sequence of new Set(this._sequences.values())) sequence.rewind()

    for (const scope of this._factorySequences.values()) {
      for (const sequence of new Set(scope.values())) sequence.rewind()
    }
  }

  /**
   * Clears all definitions, traits, sequences and registry defaults, restoring an
   * empty registry with the built-in strategies.
   * @returns {void}
   */
  reset() {
    this._assertNotEvaluating("reset")
    this._factories.clear()
    this._globalTraits.clear()
    this._sequences.clear()
    this._factorySequences.clear()
    this._globalDeclarations = []
    this._events = new FactoryEventEmitter()
  }

  /**
   * Runs `count` sequential strategy invocations.
   * @param {"attributesFor" | "build" | "create"} strategy - Strategy name.
   * @param {string} factoryName - Factory name.
   * @param {number} count - Number of entries.
   * @param {Array<?>} args - Trait names then an optional overrides object.
   * @returns {Promise<Array<?>>} - The results.
   */
  async _runList(strategy, factoryName, count, args) {
    const {traits, overrides} = normalizeInvocationArgs(args)
    /** @type {Array<?>} */
    const results = []
    /** @type {import("./factory-runner.js").CompiledPlan | undefined} */
    let planTemplate

    this._activeEvaluations += 1

    try {
      for (let index = 0; index < count; index++) {
        const invocation = await this._runFactoryInvocation({factoryName, traits, overrides, strategy, planTemplate})

        planTemplate = invocation.planTemplate
        results.push(invocation.result)
      }
    } finally {
      this._activeEvaluations -= 1
    }

    return results
  }

  /**
   * Compiles and runs a factory invocation under a strategy.
   * @param {object} args - Options.
   * @param {string} args.factoryName - Factory name.
   * @param {string[]} args.traits - Ordered traits.
   * @param {Record<string, ?>} args.overrides - Overrides.
   * @param {"attributesFor" | "build" | "create"} args.strategy - Strategy name.
   * @returns {Promise<?>} - The strategy result.
   */
  async _runFactory(args) {
    return (await this._runFactoryInvocation(args)).result
  }

  /**
   * Runs one event-tracked invocation, optionally reusing declaration planning.
   * @param {object} args - Options.
   * @param {string} args.factoryName - Factory name.
   * @param {string[]} args.traits - Ordered traits.
   * @param {Record<string, ?>} args.overrides - Overrides.
   * @param {"attributesFor" | "build" | "create"} args.strategy - Strategy name.
   * @param {import("./factory-runner.js").CompiledPlan} [args.planTemplate] - Reusable declaration plan.
   * @returns {Promise<{result: ?, planTemplate: import("./factory-runner.js").CompiledPlan}>} - Result and declaration plan.
   */
  async _runFactoryInvocation({factoryName, traits, overrides, strategy, planTemplate}) {
    this._activeEvaluations += 1

    const invocationId = this._events.nextInvocationId()
    const startedAt = Date.now()

    try {
      this._events.emit("start", {invocationId, factory: factoryName, strategy, traits})

      const compiledPlanTemplate = planTemplate || this._runner.compileTemplate(factoryName, traits)
      const compiledPlan = this._runner.applyOverrides(compiledPlanTemplate, overrides)
      const result = await this._strategies[strategy].run({registry: this, plan: compiledPlan})

      this._events.emit("success", {invocationId, factory: factoryName, strategy, traits, durationMs: Date.now() - startedAt})

      return {result, planTemplate: compiledPlanTemplate}
    } catch (error) {
      this._events.emit("failure", {invocationId, factory: factoryName, strategy, traits, durationMs: Date.now() - startedAt, error})

      throw error
    } finally {
      this._activeEvaluations -= 1
    }
  }

  /**
   * Registers an immutable factory definition and its aliases.
   * @param {import("./factory-definition.js").default} definition - Compiled factory.
   * @returns {void}
   */
  _registerFactoryDefinition(definition) {
    for (const name of [definition.name, ...definition.aliases]) {
      if (this._factories.has(name)) {
        throw new DuplicateDefinitionError(`Factory "${name}" is already registered`)
      }
    }

    for (const name of [definition.name, ...definition.aliases]) {
      this._factories.set(name, definition)
    }
  }

  /**
   * Replaces an existing factory definition (and its aliases) with a recompiled
   * one. Used by `modify`; no duplicate check because it intentionally overwrites.
   * @param {import("./factory-definition.js").default} definition - Recompiled factory.
   * @returns {void}
   */
  _replaceFactoryDefinition(definition) {
    for (const name of [definition.name, ...definition.aliases]) {
      this._factories.set(name, definition)
    }
  }

  /**
   * Registers a global trait.
   * @param {import("./trait-definition.js").default} trait - Compiled trait.
   * @returns {void}
   */
  _registerGlobalTrait(trait) {
    if (this._globalTraits.has(trait.name)) {
      throw new DuplicateDefinitionError(`Trait "${trait.name}" is already registered`)
    }

    this._globalTraits.set(trait.name, trait)
  }

  /**
   * Registers a sequence (and its aliases) either globally or under a factory scope.
   * @param {import("./sequence.js").default} sequence - Sequence instance.
   * @param {string | null} factoryScope - Factory name to scope under, or null for global.
   * @returns {void}
   */
  _registerSequence(sequence, factoryScope) {
    /** @type {Map<string, import("./sequence.js").default>} */
    let target

    if (factoryScope) {
      if (!this._factorySequences.has(factoryScope)) this._factorySequences.set(factoryScope, new Map())
      target = /** @type {Map<string, import("./sequence.js").default>} */ (this._factorySequences.get(factoryScope))
    } else {
      target = this._sequences
    }

    for (const name of [sequence.name, ...sequence.aliases]) {
      if (target.has(name)) {
        throw new DuplicateDefinitionError(`Sequence "${name}" is already registered${factoryScope ? ` for factory "${factoryScope}"` : ""}`)
      }
    }

    for (const name of [sequence.name, ...sequence.aliases]) {
      target.set(name, sequence)
    }
  }

  /**
   * Appends a registry-level default declaration (callbacks/construction defaults).
   * @param {import("./declarations.js").Declaration} declaration - Declaration to add.
   * @returns {void}
   */
  _addGlobalDeclaration(declaration) {
    this._globalDeclarations.push(declaration)
  }

  /**
   * Resolves a sequence name against a factory scope chain (child first) then the
   * global scope and advances it.
   * @param {string} sequenceName - Sequence name.
   * @param {string[]} chainNames - Inheritance chain names (child last).
   * @returns {Promise<?>} - The formatted value.
   */
  async _generateScoped(sequenceName, chainNames) {
    for (let index = chainNames.length - 1; index >= 0; index--) {
      const scope = this._factorySequences.get(chainNames[index])

      if (scope && scope.has(sequenceName)) {
        return await /** @type {import("./sequence.js").default} */ (scope.get(sequenceName)).next()
      }
    }

    return await this._resolveGlobalSequence(sequenceName).next()
  }

  /**
   * Resolves a global sequence by name.
   * @param {string} sequenceName - Sequence name.
   * @returns {import("./sequence.js").default} - The sequence.
   */
  _resolveGlobalSequence(sequenceName) {
    const sequence = this._sequences.get(sequenceName)

    if (!sequence) {
      throw new UndefinedSequenceError(`No sequence registered called "${sequenceName}"`)
    }

    return sequence
  }

  /**
   * Rejects setup-time mutation while evaluations are active.
   * @param {string} operation - Operation name, for the error message.
   * @returns {void}
   */
  _assertNotEvaluating(operation) {
    if (this._activeEvaluations > 0) {
      throw new RegistryBusyError(`Cannot ${operation} while factory evaluations are active. Registry mutation is setup-time only.`)
    }
  }
}
