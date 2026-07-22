// @ts-check

import {isPlainObject} from "is-plain-object"
import DatabaseRecord from "../../database/record/index.js"
import {
  attributeDeclaration,
  callbackDeclaration,
  initializeWithDeclaration,
  skipCreateDeclaration,
  toCreateDeclaration,
  traitIncludeDeclaration
} from "./declarations.js"
import AssociationDeclaration from "./association-declaration.js"
import FactoryDefinition from "./factory-definition.js"
import Sequence from "./sequence.js"
import TraitDefinition from "./trait-definition.js"
import {InvalidDefinitionError} from "./errors.js"

/** Callback phases accepted by `before`/`after` mapped to their event suffix. */
const CALLBACK_PHASES = {all: "All", build: "Build", create: "Create"}

/**
 * Resolves a `before`/`after` phase into the concrete event name.
 * @param {"before" | "after"} prefix - Callback prefix.
 * @param {string} phase - Declared phase (all/build/create).
 * @returns {string} - Concrete event name (e.g. "afterCreate").
 */
function eventNameFor(prefix, phase) {
  const suffix = /** @type {Record<string, string>} */ (CALLBACK_PHASES)[phase]

  if (!suffix) {
    throw new InvalidDefinitionError(`Unknown callback phase "${String(phase)}". Use one of: ${Object.keys(CALLBACK_PHASES).join(", ")}`)
  }

  return `${prefix}${suffix}`
}

/**
 * Validates a declared name is a non-empty string.
 * @param {string} name - Name to validate.
 * @param {string} what - What is being named (for the message).
 * @returns {void}
 */
function assertName(name, what) {
  if (!name || typeof name !== "string") {
    throw new InvalidDefinitionError(`${what} name must be a non-empty string, got: ${String(name)}`)
  }
}

/**
 * Builds an association declaration from the loose `association(name, ...)` args:
 * leading strings are traits and a trailing plain object supplies factory/strategy
 * plus overrides.
 * @param {string} name - Relationship name.
 * @param {Array<?>} args - Remaining arguments.
 * @returns {AssociationDeclaration} - The declaration.
 */
function buildAssociationDeclaration(name, args) {
  /** @type {string[]} */
  const traits = []
  /** @type {Record<string, ?>} */
  let options = {}

  for (const arg of args) {
    if (typeof arg === "string") {
      traits.push(arg)
    } else if (isPlainObject(arg)) {
      options = arg
    } else {
      throw new InvalidDefinitionError(`Invalid association argument for "${name}": ${String(arg)}`)
    }
  }

  const {factory, strategy, ...overrides} = options

  return new AssociationDeclaration({name, factory, strategy, traits, overrides})
}

/**
 * Parses the polymorphic `sequence(name, ...)` argument forms into a Sequence.
 * @param {string} name - Sequence name.
 * @param {Array<?>} args - Remaining arguments (initial/options and/or formatter).
 * @returns {Sequence} - The constructed sequence.
 */
function buildSequence(name, args) {
  assertName(name, "Sequence")

  let initial = 1
  /** @type {string[]} */
  let aliases = []
  /** @type {import("./sequence.js").SequenceFormatter | undefined} */
  let formatter

  for (const arg of args) {
    if (typeof arg === "function") {
      formatter = arg
    } else if (typeof arg === "number") {
      initial = arg
    } else if (isPlainObject(arg)) {
      if (typeof arg.initial === "number") initial = arg.initial
      if (Array.isArray(arg.aliases)) aliases = arg.aliases
    } else if (arg !== undefined) {
      throw new InvalidDefinitionError(`Invalid sequence argument for "${name}": ${String(arg)}`)
    }
  }

  return new Sequence({name, initial, formatter, aliases})
}

/**
 * Collects declarations for one factory/trait block. Shared by factory blocks,
 * trait blocks and the root registry-defaults block.
 */
class DeclarationCollector {
  /** Builds a collector. */
  constructor() {
    /** @type {import("./declarations.js").Declaration[]} - Ordered declarations. */
    this.declarations = []
  }

  /**
   * Records a literal/lazy attribute.
   * @param {string} name - Attribute name.
   * @param {?} value - Literal value or lazy function.
   * @returns {void}
   */
  attribute(name, value) {
    assertName(name, "Attribute")
    this.declarations.push(attributeDeclaration(name, value, false))
  }

  /**
   * Records a transient attribute.
   * @param {string} name - Transient name.
   * @param {?} value - Literal value or lazy function.
   * @returns {void}
   */
  transient(name, value) {
    assertName(name, "Transient")
    this.declarations.push(attributeDeclaration(name, value, true))
  }

  /**
   * Records an association.
   * @param {string} name - Relationship name.
   * @param {Array<?>} args - Traits and/or an options object.
   * @returns {void}
   */
  association(name, ...args) {
    assertName(name, "Association")
    this.declarations.push(buildAssociationDeclaration(name, args))
  }

  /**
   * Records a before-callback.
   * @param {string} phase - Phase (all/build/create).
   * @param {import("./declarations.js").CallbackDeclaration["fn"]} fn - Callback body.
   * @returns {void}
   */
  before(phase, fn) {
    this.declarations.push(callbackDeclaration(eventNameFor("before", phase), fn))
  }

  /**
   * Records an after-callback.
   * @param {string} phase - Phase (all/build/create).
   * @param {import("./declarations.js").CallbackDeclaration["fn"]} fn - Callback body.
   * @returns {void}
   */
  after(phase, fn) {
    this.declarations.push(callbackDeclaration(eventNameFor("after", phase), fn))
  }

  /**
   * Records a custom constructor.
   * @param {import("./declarations.js").InitializeWithDeclaration["fn"]} fn - Constructor body.
   * @returns {void}
   */
  initializeWith(fn) {
    this.declarations.push(initializeWithDeclaration(fn))
  }

  /**
   * Records a custom persistence hook.
   * @param {import("./declarations.js").ToCreateDeclaration["fn"]} fn - Persistence body.
   * @returns {void}
   */
  toCreate(fn) {
    this.declarations.push(toCreateDeclaration(fn))
  }

  /**
   * Records that persistence should be skipped for the create strategy.
   * @returns {void}
   */
  skipCreate() {
    this.declarations.push(skipCreateDeclaration())
  }
}

/**
 * Runs a trait block against a fresh collector and compiles it into a definition.
 * @param {string} name - Trait name.
 * @param {(builder: object) => void} callback - Trait builder callback.
 * @returns {TraitDefinition} - Compiled trait.
 */
function compileTrait(name, callback) {
  assertName(name, "Trait")

  if (typeof callback !== "function") {
    throw new InvalidDefinitionError(`Trait "${name}" requires a builder function`)
  }

  const collector = new DeclarationCollector()
  const builder = {
    attribute: (/** @type {string} */ attrName, /** @type {?} */ value) => collector.attribute(attrName, value),
    transient: (/** @type {string} */ attrName, /** @type {?} */ value) => collector.transient(attrName, value),
    association: (/** @type {string} */ assocName, /** @type {Array<?>} */ ...args) => collector.association(assocName, ...args),
    before: (/** @type {string} */ phase, /** @type {?} */ fn) => collector.before(phase, fn),
    after: (/** @type {string} */ phase, /** @type {?} */ fn) => collector.after(phase, fn),
    initializeWith: (/** @type {?} */ fn) => collector.initializeWith(fn),
    toCreate: (/** @type {?} */ fn) => collector.toCreate(fn),
    skipCreate: () => collector.skipCreate(),
    trait: (/** @type {string} */ includeName) => {
      assertName(includeName, "Trait include")
      collector.declarations.push(traitIncludeDeclaration(includeName))
    }
  }

  callback(builder)

  return new TraitDefinition({name, declarations: collector.declarations})
}

/**
 * A single `define`/`modify` session. It walks the builder callbacks, compiles
 * immutable definitions and registers them into the target registry, throwing on
 * duplicate or structurally invalid declarations at definition time.
 */
export default class DefinitionSession {
  /**
   * Builds a session.
   * @param {import("./factory-registry.js").default} registry - Target registry.
   */
  constructor(registry) {
    /** @type {import("./factory-registry.js").default} - Target registry. */
    this.registry = registry
  }

  /**
   * Runs a root `define` callback.
   * @param {(builder: object) => void} callback - Root builder callback.
   * @returns {void}
   */
  run(callback) {
    if (typeof callback !== "function") {
      throw new InvalidDefinitionError("define requires a builder callback")
    }

    callback(this._rootBuilder())
  }

  /**
   * Runs a `modify` callback that reopens existing factories to append/override
   * declarations, recompiling each into a fresh immutable definition rather than
   * mutating the original.
   * @param {(builder: object) => void} callback - Modify builder callback.
   * @returns {void}
   */
  runModify(callback) {
    if (typeof callback !== "function") {
      throw new InvalidDefinitionError("modify requires a builder callback")
    }

    callback(this._modifyBuilder())
  }

  /**
   * Builds the builder object exposed to `modify`.
   * @returns {object} - Modify builder.
   */
  _modifyBuilder() {
    return {
      factory: (/** @type {string} */ name, /** @type {(builder: object) => void} */ cb) => this._modifyFactory(name, cb),
      trait: (/** @type {string} */ name, /** @type {(builder: object) => void} */ cb) =>
        this.registry._registerGlobalTrait(compileTrait(name, cb)),
      sequence: (/** @type {string} */ name, /** @type {Array<?>} */ ...args) =>
        this.registry._registerSequence(buildSequence(name, args), null),
      before: (/** @type {string} */ phase, /** @type {?} */ fn) =>
        this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("before", phase), fn)),
      after: (/** @type {string} */ phase, /** @type {?} */ fn) =>
        this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("after", phase), fn)),
      initializeWith: (/** @type {?} */ fn) => this.registry._addGlobalDeclaration(initializeWithDeclaration(fn)),
      toCreate: (/** @type {?} */ fn) => this.registry._addGlobalDeclaration(toCreateDeclaration(fn)),
      skipCreate: () => this.registry._addGlobalDeclaration(skipCreateDeclaration())
    }
  }

  /**
   * Recompiles an existing factory with appended declarations.
   * @param {string} name - Existing factory name.
   * @param {(builder: object) => void} cb - Factory builder callback.
   * @returns {void}
   */
  _modifyFactory(name, cb) {
    assertName(name, "Factory")

    const existing = this.registry._factories.get(name)

    if (!existing) {
      throw new InvalidDefinitionError(`Cannot modify unknown factory "${name}"`)
    }

    const collector = new DeclarationCollector()
    /** @type {Array<{name: string, modelOrOptions: ?, cb: ?}>} */
    const nestedFactories = []
    const localTraits = new Map(existing.localTraits)
    /** @type {Sequence[]} */
    const scopedSequences = []

    if (typeof cb === "function") {
      cb(this._factoryBuilder(collector, nestedFactories, localTraits, scopedSequences))
    }

    const merged = new FactoryDefinition({
      name: existing.name,
      modelClass: existing.modelClass,
      parentName: existing.parentName,
      aliases: [...existing.aliases],
      declarations: [...existing.declarations, ...collector.declarations],
      localTraits
    })

    this.registry._replaceFactoryDefinition(merged)

    for (const sequence of scopedSequences) {
      this.registry._registerSequence(sequence, name)
    }

    for (const nested of nestedFactories) {
      this._defineFactory(nested.name, nested.modelOrOptions, nested.cb, name)
    }
  }

  /**
   * Builds the root builder object exposed to `define`.
   * @returns {object} - Root builder.
   */
  _rootBuilder() {
    return {
      factory: (/** @type {string} */ name, /** @type {?} */ modelOrOptions, /** @type {?} */ cb) =>
        this._defineFactory(name, modelOrOptions, cb, null),
      trait: (/** @type {string} */ name, /** @type {(builder: object) => void} */ cb) =>
        this.registry._registerGlobalTrait(compileTrait(name, cb)),
      sequence: (/** @type {string} */ name, /** @type {Array<?>} */ ...args) =>
        this.registry._registerSequence(buildSequence(name, args), null),
      before: (/** @type {string} */ phase, /** @type {?} */ fn) =>
        this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("before", phase), fn)),
      after: (/** @type {string} */ phase, /** @type {?} */ fn) =>
        this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("after", phase), fn)),
      initializeWith: (/** @type {?} */ fn) => this.registry._addGlobalDeclaration(initializeWithDeclaration(fn)),
      toCreate: (/** @type {?} */ fn) => this.registry._addGlobalDeclaration(toCreateDeclaration(fn)),
      skipCreate: () => this.registry._addGlobalDeclaration(skipCreateDeclaration())
    }
  }

  /**
   * Compiles and registers a factory (and its nested children/local traits/scoped
   * sequences).
   * @param {string} name - Factory name.
   * @param {?} modelOrOptions - Model class or options object.
   * @param {?} cb - Factory builder callback.
   * @param {string | null} inheritedParent - Parent name for nested factories.
   * @returns {void}
   */
  _defineFactory(name, modelOrOptions, cb, inheritedParent) {
    assertName(name, "Factory")

    let modelClass = null
    let builderCallback = cb
    /** @type {Record<string, ?>} */
    let options = {}

    if (typeof cb === "function") {
      // Three-argument form: the second argument is the model class or options.
      if (typeof modelOrOptions === "function") {
        modelClass = modelOrOptions
      } else if (isPlainObject(modelOrOptions)) {
        options = modelOrOptions
        modelClass = options.model || options.class || null
      } else if (modelOrOptions !== undefined) {
        throw new InvalidDefinitionError(`Factory "${name}" model must be a class or an options object`)
      }
    } else if (typeof modelOrOptions === "function") {
      // Two-argument form with a trailing function. A backend model class means
      // "no builder"; any other function is the builder (child inherits its model).
      if (modelOrOptions.prototype instanceof DatabaseRecord) {
        modelClass = modelOrOptions
      } else {
        builderCallback = modelOrOptions
      }
    } else if (isPlainObject(modelOrOptions)) {
      options = modelOrOptions
      modelClass = options.model || options.class || null
    } else if (modelOrOptions !== undefined) {
      throw new InvalidDefinitionError(`Factory "${name}" model must be a class or an options object`)
    }

    const parentName = options.parent || inheritedParent || null
    const aliases = Array.isArray(options.aliases) ? options.aliases : []
    const baseTraits = Array.isArray(options.traits) ? options.traits : []

    const collector = new DeclarationCollector()
    /** @type {Array<{name: string, modelOrOptions: ?, cb: ?}>} */
    const nestedFactories = []
    /** @type {Map<string, TraitDefinition>} */
    const localTraits = new Map()
    /** @type {Sequence[]} */
    const scopedSequences = []

    if (typeof builderCallback === "function") {
      builderCallback(this._factoryBuilder(collector, nestedFactories, localTraits, scopedSequences))
    }

    const declarations = [...baseTraits.map((traitName) => traitIncludeDeclaration(traitName)), ...collector.declarations]
    const definition = new FactoryDefinition({name, modelClass, parentName, aliases, declarations, localTraits})

    this.registry._registerFactoryDefinition(definition)

    for (const sequence of scopedSequences) {
      this.registry._registerSequence(sequence, name)
    }

    for (const nested of nestedFactories) {
      this._defineFactory(nested.name, nested.modelOrOptions, nested.cb, name)
    }
  }

  /**
   * Builds the factory builder object.
   * @param {DeclarationCollector} collector - Declaration collector.
   * @param {Array<{name: string, modelOrOptions: ?, cb: ?}>} nestedFactories - Nested factory sink.
   * @param {Map<string, TraitDefinition>} localTraits - Local trait sink.
   * @param {Sequence[]} scopedSequences - Scoped sequence sink.
   * @returns {object} - Factory builder.
   */
  _factoryBuilder(collector, nestedFactories, localTraits, scopedSequences) {
    return {
      attribute: (/** @type {string} */ attrName, /** @type {?} */ value) => collector.attribute(attrName, value),
      transient: (/** @type {string} */ attrName, /** @type {?} */ value) => collector.transient(attrName, value),
      association: (/** @type {string} */ assocName, /** @type {Array<?>} */ ...args) => collector.association(assocName, ...args),
      before: (/** @type {string} */ phase, /** @type {?} */ fn) => collector.before(phase, fn),
      after: (/** @type {string} */ phase, /** @type {?} */ fn) => collector.after(phase, fn),
      initializeWith: (/** @type {?} */ fn) => collector.initializeWith(fn),
      toCreate: (/** @type {?} */ fn) => collector.toCreate(fn),
      skipCreate: () => collector.skipCreate(),
      sequence: (/** @type {string} */ seqName, /** @type {Array<?>} */ ...args) => scopedSequences.push(buildSequence(seqName, args)),
      trait: (/** @type {string} */ traitName, /** @type {((builder: object) => void) | undefined} */ traitCb) => {
        if (typeof traitCb === "function") {
          const compiled = compileTrait(traitName, traitCb)

          if (localTraits.has(traitName)) {
            throw new InvalidDefinitionError(`Local trait "${traitName}" is already defined on this factory`)
          }

          localTraits.set(traitName, compiled)
        } else {
          assertName(traitName, "Trait include")
          collector.declarations.push(traitIncludeDeclaration(traitName))
        }
      },
      factory: (/** @type {string} */ childName, /** @type {?} */ childModelOrOptions, /** @type {?} */ childCb) =>
        nestedFactories.push({name: childName, modelOrOptions: childModelOrOptions, cb: childCb})
    }
  }
}
