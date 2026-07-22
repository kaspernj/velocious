// @ts-check

import {FactoryCycleError, UndefinedFactoryError, UndefinedTraitError} from "./errors.js"

/**
 * A resolved attribute/transient/association slot in a compiled plan.
 * @typedef {object} Slot
 * @property {"attribute" | "transient" | "association"} slotKind - Slot nature.
 * @property {?} value - Literal/lazy value, override value, or AssociationDeclaration.
 * @property {boolean} isOverride - Whether the value came from a call-site override.
 */

/**
 * The immutable result of compiling a factory invocation.
 * @typedef {object} CompiledPlan
 * @property {string} factoryName - Target factory name.
 * @property {import("./factory-definition.js").default} factoryDefinition - Target definition.
 * @property {(new (attributes?: Record<string, ?>) => ?) | null} modelClass - Resolved model class.
 * @property {string[]} chainNames - Inheritance chain names (child last) for sequence scope.
 * @property {Map<string, Slot>} resolved - Name→slot map (last declaration wins).
 * @property {Map<string, import("./declarations.js").CallbackDeclaration[]>} callbacks - Deduped callbacks by event.
 * @property {import("./declarations.js").InitializeWithDeclaration["fn"] | null} initializeWith - Custom constructor, or null.
 * @property {import("./declarations.js").ToCreateDeclaration["fn"] | null} toCreate - Custom persistence, or null.
 * @property {boolean} skipCreate - Whether persistence is skipped.
 */

/**
 * Compiles factory invocations into immutable plans by resolving the inheritance
 * chain, expanding base and requested traits, and folding declarations into a
 * name→slot map plus a deduped, ordered callback set.
 */
export default class FactoryRunner {
  /**
   * Builds a runner.
   * @param {import("./factory-registry.js").default} registry - Owning registry.
   */
  constructor(registry) {
    /** @type {import("./factory-registry.js").default} - Owning registry. */
    this.registry = registry
  }

  /**
   * Compiles a factory invocation into a plan.
   * @param {string} factoryName - Factory to run.
   * @param {string[]} requestedTraits - Traits requested at the call site, in order.
   * @param {Record<string, ?>} overrides - Call-site overrides (highest precedence).
   * @returns {CompiledPlan} - The compiled plan.
   */
  compile(factoryName, requestedTraits, overrides) {
    const chain = this._resolveChain(factoryName)
    const target = chain[chain.length - 1]
    const modelClass = this._resolveModelClass(chain)

    /** @type {Array<{decl: import("./declarations.js").Declaration}>} */
    const flattened = []

    for (const declaration of this.registry._globalDeclarations) {
      flattened.push({decl: declaration})
    }

    for (const factoryDefinition of chain) {
      this._expandFactoryDeclarations(factoryDefinition, target, flattened)
    }

    for (const traitName of requestedTraits) {
      this._expandTrait(traitName, target, flattened, [])
    }

    return this._buildPlan({flattened, overrides, modelClass, target, chainNames: chain.map((definition) => definition.name)})
  }

  /**
   * Resolves the inheritance chain from the root parent down to the target.
   * @param {string} factoryName - Target factory name.
   * @returns {import("./factory-definition.js").default[]} - Chain (root first, target last).
   */
  _resolveChain(factoryName) {
    /** @type {import("./factory-definition.js").default[]} */
    const chain = []
    /** @type {Set<string>} */
    const seen = new Set()
    /** @type {import("./factory-definition.js").default | null} */
    let current = this._resolveFactory(factoryName)

    while (current) {
      if (seen.has(current.name)) {
        throw new FactoryCycleError(`Factory inheritance cycle detected: ${[...seen, current.name].join(" -> ")}`)
      }

      seen.add(current.name)
      chain.unshift(current)
      current = current.parentName ? this._resolveFactory(current.parentName) : null
    }

    return chain
  }

  /**
   * Resolves a factory definition by name (or alias).
   * @param {string} factoryName - Factory name.
   * @returns {import("./factory-definition.js").default} - The definition.
   */
  _resolveFactory(factoryName) {
    const definition = this.registry._factories.get(factoryName)

    if (!definition) {
      throw new UndefinedFactoryError(`No factory registered called "${factoryName}". Registered: ${[...this.registry._factories.keys()].join(", ") || "(none)"}`)
    }

    return definition
  }

  /**
   * Picks the nearest declared model class in the chain (child overrides parent).
   * @param {import("./factory-definition.js").default[]} chain - Inheritance chain.
   * @returns {(new (attributes?: Record<string, ?>) => ?) | null} - The model class, or null.
   */
  _resolveModelClass(chain) {
    for (let index = chain.length - 1; index >= 0; index--) {
      if (chain[index].modelClass) return chain[index].modelClass
    }

    return null
  }

  /**
   * Expands one factory's own declarations, inlining base-trait inclusions.
   * @param {import("./factory-definition.js").default} factoryDefinition - Factory whose declarations are expanded.
   * @param {import("./factory-definition.js").default} scope - Target factory (for local-trait resolution).
   * @param {Array<{decl: import("./declarations.js").Declaration}>} out - Flattened output sink.
   * @returns {void}
   */
  _expandFactoryDeclarations(factoryDefinition, scope, out) {
    for (const declaration of factoryDefinition.declarations) {
      if (declaration.kind === "traitInclude") {
        this._expandTrait(declaration.name, scope, out, [])
      } else {
        out.push({decl: declaration})
      }
    }
  }

  /**
   * Expands a trait (resolving factory-local before global) and its inclusions.
   * @param {string} traitName - Trait to expand.
   * @param {import("./factory-definition.js").default} scope - Target factory (for local-trait resolution).
   * @param {Array<{decl: import("./declarations.js").Declaration}>} out - Flattened output sink.
   * @param {string[]} activePath - Trait inclusion path (for cycle detection).
   * @returns {void}
   */
  _expandTrait(traitName, scope, out, activePath) {
    if (activePath.includes(traitName)) {
      throw new FactoryCycleError(`Trait inclusion cycle detected: ${[...activePath, traitName].join(" -> ")}`)
    }

    const trait = scope.localTraits.get(traitName) || this.registry._globalTraits.get(traitName)

    if (!trait) {
      throw new UndefinedTraitError(`No trait registered called "${traitName}" for factory "${scope.name}"`)
    }

    for (const declaration of trait.declarations) {
      if (declaration.kind === "traitInclude") {
        this._expandTrait(declaration.name, scope, out, [...activePath, traitName])
      } else {
        out.push({decl: declaration})
      }
    }
  }

  /**
   * Folds flattened declarations plus overrides into a compiled plan.
   * @param {object} args - Options.
   * @param {Array<{decl: import("./declarations.js").Declaration}>} args.flattened - Flattened declarations.
   * @param {Record<string, ?>} args.overrides - Call-site overrides.
   * @param {(new (attributes?: Record<string, ?>) => ?) | null} args.modelClass - Resolved model class.
   * @param {import("./factory-definition.js").default} args.target - Target factory definition.
   * @param {string[]} args.chainNames - Inheritance chain names.
   * @returns {CompiledPlan} - The compiled plan.
   */
  _buildPlan({flattened, overrides, modelClass, target, chainNames}) {
    /** @type {Map<string, Slot>} */
    const resolved = new Map()
    /** @type {Map<string, import("./declarations.js").CallbackDeclaration[]>} */
    const callbacks = new Map()
    /** @type {Set<import("./declarations.js").CallbackDeclaration>} */
    const seenCallbacks = new Set()
    /** @type {import("./declarations.js").InitializeWithDeclaration["fn"] | null} */
    let initializeWith = null
    /** @type {import("./declarations.js").ToCreateDeclaration["fn"] | null} */
    let toCreate = null
    let skipCreate = false

    for (const {decl} of flattened) {
      if (decl.kind === "attribute") {
        resolved.set(decl.name, {slotKind: decl.isTransient ? "transient" : "attribute", value: decl.value, isOverride: false})
      } else if (decl.kind === "association") {
        resolved.set(decl.name, {slotKind: "association", value: decl, isOverride: false})
      } else if (decl.kind === "callback") {
        if (!seenCallbacks.has(decl)) {
          seenCallbacks.add(decl)

          const eventCallbacks = callbacks.get(decl.event) || []

          eventCallbacks.push(decl)
          callbacks.set(decl.event, eventCallbacks)
        }
      } else if (decl.kind === "initializeWith") {
        initializeWith = decl.fn
      } else if (decl.kind === "toCreate") {
        toCreate = decl.fn
      } else if (decl.kind === "skipCreate") {
        skipCreate = true
      }
    }

    for (const key of Object.keys(overrides)) {
      const prior = resolved.get(key)

      resolved.set(key, {slotKind: prior ? prior.slotKind : "attribute", value: overrides[key], isOverride: true})
    }

    return {
      factoryName: target.name,
      factoryDefinition: target,
      modelClass,
      chainNames,
      resolved,
      callbacks,
      initializeWith,
      toCreate,
      skipCreate
    }
  }
}
