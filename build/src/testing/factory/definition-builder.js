// @ts-check
import { isPlainObject } from "is-plain-object";
import DatabaseRecord from "../../database/record/index.js";
import { attributeDeclaration, callbackDeclaration, initializeWithDeclaration, skipCreateDeclaration, toCreateDeclaration, traitIncludeDeclaration } from "./declarations.js";
import AssociationDeclaration from "./association-declaration.js";
import FactoryDefinition from "./factory-definition.js";
import Sequence from "./sequence.js";
import TraitDefinition from "./trait-definition.js";
import { InvalidDefinitionError } from "./errors.js";
/** Callback phases accepted by `before`/`after` mapped to their event suffix. */
const CALLBACK_PHASES = { all: "All", build: "Build", create: "Create" };
/**
 * Resolves a `before`/`after` phase into the concrete event name.
 * @param {"before" | "after"} prefix - Callback prefix.
 * @param {string} phase - Declared phase (all/build/create).
 * @returns {string} - Concrete event name (e.g. "afterCreate").
 */
function eventNameFor(prefix, phase) {
    const suffix = /** @type {Record<string, string>} */ (CALLBACK_PHASES)[phase];
    if (!suffix) {
        throw new InvalidDefinitionError(`Unknown callback phase "${String(phase)}". Use one of: ${Object.keys(CALLBACK_PHASES).join(", ")}`);
    }
    return `${prefix}${suffix}`;
}
/**
 * Validates a declared name is a non-empty string.
 * @param {string} name - Name to validate.
 * @param {string} what - What is being named (for the message).
 * @returns {void}
 */
function assertName(name, what) {
    if (!name || typeof name !== "string") {
        throw new InvalidDefinitionError(`${what} name must be a non-empty string, got: ${String(name)}`);
    }
}
/**
 * Builds an association declaration from the loose `association(name, ...)` args:
 * leading strings are traits and a trailing plain object supplies factory/strategy
 * plus overrides.
 * @param {string} name - Relationship name.
 * @param {Array<ReturnType<typeof JSON.parse>>} args - Remaining arguments.
 * @returns {AssociationDeclaration} - The declaration.
 */
function buildAssociationDeclaration(name, args) {
    /** @type {string[]} */
    const traits = [];
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let options = {};
    for (const arg of args) {
        if (typeof arg === "string") {
            traits.push(arg);
        }
        else if (isPlainObject(arg)) {
            options = arg;
        }
        else {
            throw new InvalidDefinitionError(`Invalid association argument for "${name}": ${String(arg)}`);
        }
    }
    const { factory, strategy, ...overrides } = options;
    return new AssociationDeclaration({ name, factory, strategy, traits, overrides });
}
/**
 * Parses the polymorphic `sequence(name, ...)` argument forms into a Sequence.
 * @param {string} name - Sequence name.
 * @param {Array<ReturnType<typeof JSON.parse>>} args - Remaining arguments (initial/options and/or formatter).
 * @returns {Sequence} - The constructed sequence.
 */
function buildSequence(name, args) {
    assertName(name, "Sequence");
    let initial = 1;
    /** @type {string[]} */
    let aliases = [];
    /** @type {import("./sequence.js").SequenceFormatter | undefined} */
    let formatter;
    for (const arg of args) {
        if (typeof arg === "function") {
            formatter = arg;
        }
        else if (typeof arg === "number") {
            initial = arg;
        }
        else if (isPlainObject(arg)) {
            if (typeof arg.initial === "number")
                initial = arg.initial;
            if (Array.isArray(arg.aliases))
                aliases = arg.aliases;
        }
        else if (arg !== undefined) {
            throw new InvalidDefinitionError(`Invalid sequence argument for "${name}": ${String(arg)}`);
        }
    }
    return new Sequence({ name, initial, formatter, aliases });
}
/**
 * Collects declarations for one factory/trait block. Shared by factory blocks,
 * trait blocks and the root registry-defaults block.
 */
class DeclarationCollector {
    /** Builds a collector. */
    constructor() {
        /** @type {import("./declarations.js").Declaration[]} - Ordered declarations. */
        this.declarations = [];
    }
    /**
     * Records a literal/lazy attribute.
     * @param {string} name - Attribute name.
     * @param {ReturnType<typeof JSON.parse>} value - Literal value or lazy function.
     * @returns {void}
     */
    attribute(name, value) {
        assertName(name, "Attribute");
        this.declarations.push(attributeDeclaration(name, value, false));
    }
    /**
     * Records a transient attribute.
     * @param {string} name - Transient name.
     * @param {ReturnType<typeof JSON.parse>} value - Literal value or lazy function.
     * @returns {void}
     */
    transient(name, value) {
        assertName(name, "Transient");
        this.declarations.push(attributeDeclaration(name, value, true));
    }
    /**
     * Records an association.
     * @param {string} name - Relationship name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Traits and/or an options object.
     * @returns {void}
     */
    association(name, ...args) {
        assertName(name, "Association");
        this.declarations.push(buildAssociationDeclaration(name, args));
    }
    /**
     * Records a before-callback.
     * @param {string} phase - Phase (all/build/create).
     * @param {import("./declarations.js").CallbackDeclaration["fn"]} fn - Callback body.
     * @returns {void}
     */
    before(phase, fn) {
        this.declarations.push(callbackDeclaration(eventNameFor("before", phase), fn));
    }
    /**
     * Records an after-callback.
     * @param {string} phase - Phase (all/build/create).
     * @param {import("./declarations.js").CallbackDeclaration["fn"]} fn - Callback body.
     * @returns {void}
     */
    after(phase, fn) {
        this.declarations.push(callbackDeclaration(eventNameFor("after", phase), fn));
    }
    /**
     * Records a custom constructor.
     * @param {import("./declarations.js").InitializeWithDeclaration["fn"]} fn - Constructor body.
     * @returns {void}
     */
    initializeWith(fn) {
        this.declarations.push(initializeWithDeclaration(fn));
    }
    /**
     * Records a custom persistence hook.
     * @param {import("./declarations.js").ToCreateDeclaration["fn"]} fn - Persistence body.
     * @returns {void}
     */
    toCreate(fn) {
        this.declarations.push(toCreateDeclaration(fn));
    }
    /**
     * Records that persistence should be skipped for the create strategy.
     * @returns {void}
     */
    skipCreate() {
        this.declarations.push(skipCreateDeclaration());
    }
}
/**
 * Runs a trait block against a fresh collector and compiles it into a definition.
 * @param {string} name - Trait name.
 * @param {(builder: object) => void} callback - Trait builder callback.
 * @returns {TraitDefinition} - Compiled trait.
 */
function compileTrait(name, callback) {
    assertName(name, "Trait");
    if (typeof callback !== "function") {
        throw new InvalidDefinitionError(`Trait "${name}" requires a builder function`);
    }
    const collector = new DeclarationCollector();
    const builder = {
        attribute: (/** @type {string} */ attrName, /** @type {ReturnType<typeof JSON.parse>} */ value) => collector.attribute(attrName, value),
        transient: (/** @type {string} */ attrName, /** @type {ReturnType<typeof JSON.parse>} */ value) => collector.transient(attrName, value),
        association: (/** @type {string} */ assocName, /** @type {Array<ReturnType<typeof JSON.parse>>} */ ...args) => collector.association(assocName, ...args),
        before: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.before(phase, fn),
        after: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.after(phase, fn),
        initializeWith: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.initializeWith(fn),
        toCreate: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.toCreate(fn),
        skipCreate: () => collector.skipCreate(),
        trait: (/** @type {string} */ includeName) => {
            assertName(includeName, "Trait include");
            collector.declarations.push(traitIncludeDeclaration(includeName));
        }
    };
    callback(builder);
    return new TraitDefinition({ name, declarations: collector.declarations });
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
        this.registry = registry;
    }
    /**
     * Runs a root `define` callback.
     * @param {(builder: object) => void} callback - Root builder callback.
     * @returns {void}
     */
    run(callback) {
        if (typeof callback !== "function") {
            throw new InvalidDefinitionError("define requires a builder callback");
        }
        callback(this._rootBuilder());
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
            throw new InvalidDefinitionError("modify requires a builder callback");
        }
        callback(this._modifyBuilder());
    }
    /**
     * Builds the builder object exposed to `modify`.
     * @returns {object} - Modify builder.
     */
    _modifyBuilder() {
        return {
            factory: (/** @type {string} */ name, /** @type {(builder: object) => void} */ cb) => this._modifyFactory(name, cb),
            trait: (/** @type {string} */ name, /** @type {(builder: object) => void} */ cb) => this.registry._registerGlobalTrait(compileTrait(name, cb)),
            sequence: (/** @type {string} */ name, /** @type {Array<ReturnType<typeof JSON.parse>>} */ ...args) => this.registry._registerSequence(buildSequence(name, args), null),
            before: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("before", phase), fn)),
            after: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("after", phase), fn)),
            initializeWith: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(initializeWithDeclaration(fn)),
            toCreate: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(toCreateDeclaration(fn)),
            skipCreate: () => this.registry._addGlobalDeclaration(skipCreateDeclaration())
        };
    }
    /**
     * Recompiles an existing factory with appended declarations.
     * @param {string} name - Existing factory name.
     * @param {(builder: object) => void} cb - Factory builder callback.
     * @returns {void}
     */
    _modifyFactory(name, cb) {
        assertName(name, "Factory");
        const existing = this.registry._factories.get(name);
        if (!existing) {
            throw new InvalidDefinitionError(`Cannot modify unknown factory "${name}"`);
        }
        const collector = new DeclarationCollector();
        /** @type {Array<{name: string, modelOrOptions: ReturnType<typeof JSON.parse>, cb: ReturnType<typeof JSON.parse>}>} */
        const nestedFactories = [];
        const localTraits = new Map(existing.localTraits);
        /** @type {Sequence[]} */
        const scopedSequences = [];
        if (typeof cb === "function") {
            cb(this._factoryBuilder(collector, nestedFactories, localTraits, scopedSequences));
        }
        const merged = new FactoryDefinition({
            name: existing.name,
            modelClass: existing.modelClass,
            parentName: existing.parentName,
            aliases: [...existing.aliases],
            declarations: [...existing.declarations, ...collector.declarations],
            localTraits
        });
        this.registry._replaceFactoryDefinition(merged);
        for (const sequence of scopedSequences) {
            this.registry._registerSequence(sequence, name);
        }
        for (const nested of nestedFactories) {
            this._defineFactory(nested.name, nested.modelOrOptions, nested.cb, name);
        }
    }
    /**
     * Builds the root builder object exposed to `define`.
     * @returns {object} - Root builder.
     */
    _rootBuilder() {
        return {
            factory: (/** @type {string} */ name, /** @type {ReturnType<typeof JSON.parse>} */ modelOrOptions, /** @type {ReturnType<typeof JSON.parse>} */ cb) => this._defineFactory(name, modelOrOptions, cb, null),
            trait: (/** @type {string} */ name, /** @type {(builder: object) => void} */ cb) => this.registry._registerGlobalTrait(compileTrait(name, cb)),
            sequence: (/** @type {string} */ name, /** @type {Array<ReturnType<typeof JSON.parse>>} */ ...args) => this.registry._registerSequence(buildSequence(name, args), null),
            before: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("before", phase), fn)),
            after: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(callbackDeclaration(eventNameFor("after", phase), fn)),
            initializeWith: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(initializeWithDeclaration(fn)),
            toCreate: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => this.registry._addGlobalDeclaration(toCreateDeclaration(fn)),
            skipCreate: () => this.registry._addGlobalDeclaration(skipCreateDeclaration())
        };
    }
    /**
     * Compiles and registers a factory (and its nested children/local traits/scoped
     * sequences).
     * @param {string} name - Factory name.
     * @param {ReturnType<typeof JSON.parse>} modelOrOptions - Model class or options object.
     * @param {ReturnType<typeof JSON.parse>} cb - Factory builder callback.
     * @param {string | null} inheritedParent - Parent name for nested factories.
     * @returns {void}
     */
    _defineFactory(name, modelOrOptions, cb, inheritedParent) {
        assertName(name, "Factory");
        let modelClass = null;
        let builderCallback = cb;
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        let options = {};
        if (typeof cb === "function") {
            // Three-argument form: the second argument is the model class or options.
            if (typeof modelOrOptions === "function") {
                modelClass = modelOrOptions;
            }
            else if (isPlainObject(modelOrOptions)) {
                options = modelOrOptions;
                modelClass = options.model || options.class || null;
            }
            else if (modelOrOptions !== undefined) {
                throw new InvalidDefinitionError(`Factory "${name}" model must be a class or an options object`);
            }
        }
        else if (typeof modelOrOptions === "function") {
            // Two-argument form with a trailing function. A backend model class means
            // "no builder"; any other function is the builder (child inherits its model).
            if (modelOrOptions.prototype instanceof DatabaseRecord) {
                modelClass = modelOrOptions;
            }
            else {
                builderCallback = modelOrOptions;
            }
        }
        else if (isPlainObject(modelOrOptions)) {
            options = modelOrOptions;
            modelClass = options.model || options.class || null;
        }
        else if (modelOrOptions !== undefined) {
            throw new InvalidDefinitionError(`Factory "${name}" model must be a class or an options object`);
        }
        const parentName = options.parent || inheritedParent || null;
        const aliases = Array.isArray(options.aliases) ? options.aliases : [];
        const baseTraits = Array.isArray(options.traits) ? options.traits : [];
        const collector = new DeclarationCollector();
        /** @type {Array<{name: string, modelOrOptions: ReturnType<typeof JSON.parse>, cb: ReturnType<typeof JSON.parse>}>} */
        const nestedFactories = [];
        /** @type {Map<string, TraitDefinition>} */
        const localTraits = new Map();
        /** @type {Sequence[]} */
        const scopedSequences = [];
        if (typeof builderCallback === "function") {
            builderCallback(this._factoryBuilder(collector, nestedFactories, localTraits, scopedSequences));
        }
        const declarations = [...baseTraits.map((traitName) => traitIncludeDeclaration(traitName)), ...collector.declarations];
        const definition = new FactoryDefinition({ name, modelClass, parentName, aliases, declarations, localTraits });
        this.registry._registerFactoryDefinition(definition);
        for (const sequence of scopedSequences) {
            this.registry._registerSequence(sequence, name);
        }
        for (const nested of nestedFactories) {
            this._defineFactory(nested.name, nested.modelOrOptions, nested.cb, name);
        }
    }
    /**
     * Builds the factory builder object.
     * @param {DeclarationCollector} collector - Declaration collector.
     * @param {Array<{name: string, modelOrOptions: ReturnType<typeof JSON.parse>, cb: ReturnType<typeof JSON.parse>}>} nestedFactories - Nested factory sink.
     * @param {Map<string, TraitDefinition>} localTraits - Local trait sink.
     * @param {Sequence[]} scopedSequences - Scoped sequence sink.
     * @returns {object} - Factory builder.
     */
    _factoryBuilder(collector, nestedFactories, localTraits, scopedSequences) {
        return {
            attribute: (/** @type {string} */ attrName, /** @type {ReturnType<typeof JSON.parse>} */ value) => collector.attribute(attrName, value),
            transient: (/** @type {string} */ attrName, /** @type {ReturnType<typeof JSON.parse>} */ value) => collector.transient(attrName, value),
            association: (/** @type {string} */ assocName, /** @type {Array<ReturnType<typeof JSON.parse>>} */ ...args) => collector.association(assocName, ...args),
            before: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.before(phase, fn),
            after: (/** @type {string} */ phase, /** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.after(phase, fn),
            initializeWith: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.initializeWith(fn),
            toCreate: (/** @type {ReturnType<typeof JSON.parse>} */ fn) => collector.toCreate(fn),
            skipCreate: () => collector.skipCreate(),
            sequence: (/** @type {string} */ seqName, /** @type {Array<ReturnType<typeof JSON.parse>>} */ ...args) => scopedSequences.push(buildSequence(seqName, args)),
            trait: (/** @type {string} */ traitName, /** @type {((builder: object) => void) | undefined} */ traitCb) => {
                if (typeof traitCb === "function") {
                    const compiled = compileTrait(traitName, traitCb);
                    if (localTraits.has(traitName)) {
                        throw new InvalidDefinitionError(`Local trait "${traitName}" is already defined on this factory`);
                    }
                    localTraits.set(traitName, compiled);
                }
                else {
                    assertName(traitName, "Trait include");
                    collector.declarations.push(traitIncludeDeclaration(traitName));
                }
            },
            factory: (/** @type {string} */ childName, /** @type {ReturnType<typeof JSON.parse>} */ childModelOrOptions, /** @type {ReturnType<typeof JSON.parse>} */ childCb) => nestedFactories.push({ name: childName, modelOrOptions: childModelOrOptions, cb: childCb })
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVmaW5pdGlvbi1idWlsZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZmFjdG9yeS9kZWZpbml0aW9uLWJ1aWxkZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUM3QyxPQUFPLGNBQWMsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUMzRCxPQUFPLEVBQ0wsb0JBQW9CLEVBQ3BCLG1CQUFtQixFQUNuQix5QkFBeUIsRUFDekIscUJBQXFCLEVBQ3JCLG1CQUFtQixFQUNuQix1QkFBdUIsRUFDeEIsTUFBTSxtQkFBbUIsQ0FBQTtBQUMxQixPQUFPLHNCQUFzQixNQUFNLDhCQUE4QixDQUFBO0FBQ2pFLE9BQU8saUJBQWlCLE1BQU0seUJBQXlCLENBQUE7QUFDdkQsT0FBTyxRQUFRLE1BQU0sZUFBZSxDQUFBO0FBQ3BDLE9BQU8sZUFBZSxNQUFNLHVCQUF1QixDQUFBO0FBQ25ELE9BQU8sRUFBQyxzQkFBc0IsRUFBQyxNQUFNLGFBQWEsQ0FBQTtBQUVsRCxpRkFBaUY7QUFDakYsTUFBTSxlQUFlLEdBQUcsRUFBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBQyxDQUFBO0FBRXRFOzs7OztHQUtHO0FBQ0gsU0FBUyxZQUFZLENBQUMsTUFBTSxFQUFFLEtBQUs7SUFDakMsTUFBTSxNQUFNLEdBQUcscUNBQXFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUU3RSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDWixNQUFNLElBQUksc0JBQXNCLENBQUMsMkJBQTJCLE1BQU0sQ0FBQyxLQUFLLENBQUMsa0JBQWtCLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENB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T0FBTyxLQUFLLFVBQVUsRUFBRSxDQUFDO29CQUNsQyxNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFBO29CQUVqRCxJQUFJLFdBQVcsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQzt3QkFDL0IsTUFBTSxJQUFJLHNCQUFzQixDQUFDLGdCQUFnQixTQUFTLHNDQUFzQyxDQUFDLENBQUE7b0JBQ25HLENBQUM7b0JBRUQsV0FBVyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUE7Z0JBQ3RDLENBQUM7cUJBQU0sQ0FBQztvQkFDTixVQUFVLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFBO29CQUN0QyxTQUFTLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO2dCQUNqRSxDQUFDO1lBQ0gsQ0FBQztZQUNELE9BQU8sRUFBRSxDQUFDLHFCQUFxQixDQUFDLFNBQVMsRUFBRSw0Q0FBNEMsQ0FBQyxtQkFBbUIsRUFBRSw0Q0FBNEMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUNuSyxlQUFlLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxjQUFjLEVBQUUsbUJBQW1CLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBQyxDQUFDO1NBQzVGLENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCBEYXRhYmFzZVJlY29yZCBmcm9tIFwiLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCB7XG4gIGF0dHJpYnV0ZURlY2xhcmF0aW9uLFxuICBjYWxsYmFja0RlY2xhcmF0aW9uLFxuICBpbml0aWFsaXplV2l0aERlY2xhcmF0aW9uLFxuICBza2lwQ3JlYXRlRGVjbGFyYXRpb24sXG4gIHRvQ3JlYXRlRGVjbGFyYXRpb24sXG4gIHRyYWl0SW5jbHVkZURlY2xhcmF0aW9uXG59IGZyb20gXCIuL2RlY2xhcmF0aW9ucy5qc1wiXG5pbXBvcnQgQXNzb2NpYXRpb25EZWNsYXJhdGlvbiBmcm9tIFwiLi9hc3NvY2lhdGlvbi1kZWNsYXJhdGlvbi5qc1wiXG5pbXBvcnQgRmFjdG9yeURlZmluaXRpb24gZnJvbSBcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCBTZXF1ZW5jZSBmcm9tIFwiLi9zZXF1ZW5jZS5qc1wiXG5pbXBvcnQgVHJhaXREZWZpbml0aW9uIGZyb20gXCIuL3RyYWl0LWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtJbnZhbGlkRGVmaW5pdGlvbkVycm9yfSBmcm9tIFwiLi9lcnJvcnMuanNcIlxuXG4vKiogQ2FsbGJhY2sgcGhhc2VzIGFjY2VwdGVkIGJ5IGBiZWZvcmVgL2BhZnRlcmAgbWFwcGVkIHRvIHRoZWlyIGV2ZW50IHN1ZmZpeC4gKi9cbmNvbnN0IENBTExCQUNLX1BIQVNFUyA9IHthbGw6IFwiQWxsXCIsIGJ1aWxkOiBcIkJ1aWxkXCIsIGNyZWF0ZTogXCJDcmVhdGVcIn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIGBiZWZvcmVgL2BhZnRlcmAgcGhhc2UgaW50byB0aGUgY29uY3JldGUgZXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7XCJiZWZvcmVcIiB8IFwiYWZ0ZXJcIn0gcHJlZml4IC0gQ2FsbGJhY2sgcHJlZml4LlxuICogQHBhcmFtIHtzdHJpbmd9IHBoYXNlIC0gRGVjbGFyZWQgcGhhc2UgKGFsbC9idWlsZC9jcmVhdGUpLlxuICogQHJldHVybnMge3N0cmluZ30gLSBDb25jcmV0ZSBldmVudCBuYW1lIChlLmcuIFwiYWZ0ZXJDcmVhdGVcIikuXG4gKi9cbmZ1bmN0aW9uIGV2ZW50TmFtZUZvcihwcmVmaXgsIHBoYXNlKSB7XG4gIGNvbnN0IHN1ZmZpeCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKENBTExCQUNLX1BIQVNFUylbcGhhc2VdXG5cbiAgaWYgKCFzdWZmaXgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZERlZmluaXRpb25FcnJvcihgVW5rbm93biBjYWxsYmFjayBwaGFzZSBcIiR7U3RyaW5nKHBoYXNlKX1cIi4gVXNlIG9uZSBvZjogJHtPYmplY3Qua2V5cyhDQUxMQkFDS19QSEFTRVMpLmpvaW4oXCIsIFwiKX1gKVxuICB9XG5cbiAgcmV0dXJuIGAke3ByZWZpeH0ke3N1ZmZpeH1gXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgZGVjbGFyZWQgbmFtZSBpcyBhIG5vbi1lbXB0eSBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUgdG8gdmFsaWRhdGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gd2hhdCAtIFdoYXQgaXMgYmVpbmcgbmFtZWQgKGZvciB0aGUgbWVzc2FnZSkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0TmFtZShuYW1lLCB3aGF0KSB7XG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRGVmaW5pdGlvbkVycm9yKGAke3doYXR9IG5hbWUgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcsIGdvdDogJHtTdHJpbmcobmFtZSl9YClcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhbiBhc3NvY2lhdGlvbiBkZWNsYXJhdGlvbiBmcm9tIHRoZSBsb29zZSBgYXNzb2NpYXRpb24obmFtZSwgLi4uKWAgYXJnczpcbiAqIGxlYWRpbmcgc3RyaW5ncyBhcmUgdHJhaXRzIGFuZCBhIHRyYWlsaW5nIHBsYWluIG9iamVjdCBzdXBwbGllcyBmYWN0b3J5L3N0cmF0ZWd5XG4gKiBwbHVzIG92ZXJyaWRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFJlbWFpbmluZyBhcmd1bWVudHMuXG4gKiBAcmV0dXJucyB7QXNzb2NpYXRpb25EZWNsYXJhdGlvbn0gLSBUaGUgZGVjbGFyYXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQXNzb2NpYXRpb25EZWNsYXJhdGlvbihuYW1lLCBhcmdzKSB7XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IHRyYWl0cyA9IFtdXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgb3B0aW9ucyA9IHt9XG5cbiAgZm9yIChjb25zdCBhcmcgb2YgYXJncykge1xuICAgIGlmICh0eXBlb2YgYXJnID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cmFpdHMucHVzaChhcmcpXG4gICAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KGFyZykpIHtcbiAgICAgIG9wdGlvbnMgPSBhcmdcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWREZWZpbml0aW9uRXJyb3IoYEludmFsaWQgYXNzb2NpYXRpb24gYXJndW1lbnQgZm9yIFwiJHtuYW1lfVwiOiAke1N0cmluZyhhcmcpfWApXG4gICAgfVxuICB9XG5cbiAgY29uc3Qge2ZhY3RvcnksIHN0cmF0ZWd5LCAuLi5vdmVycmlkZXN9ID0gb3B0aW9uc1xuXG4gIHJldHVybiBuZXcgQXNzb2NpYXRpb25EZWNsYXJhdGlvbih7bmFtZSwgZmFjdG9yeSwgc3RyYXRlZ3ksIHRyYWl0cywgb3ZlcnJpZGVzfSlcbn1cblxuLyoqXG4gKiBQYXJzZXMgdGhlIHBvbHltb3JwaGljIGBzZXF1ZW5jZShuYW1lLCAuLi4pYCBhcmd1bWVudCBmb3JtcyBpbnRvIGEgU2VxdWVuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFNlcXVlbmNlIG5hbWUuXG4gKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFJlbWFpbmluZyBhcmd1bWVudHMgKGluaXRpYWwvb3B0aW9ucyBhbmQvb3IgZm9ybWF0dGVyKS5cbiAqIEByZXR1cm5zIHtTZXF1ZW5jZX0gLSBUaGUgY29uc3RydWN0ZWQgc2VxdWVuY2UuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkU2VxdWVuY2UobmFtZSwgYXJncykge1xuICBhc3NlcnROYW1lKG5hbWUsIFwiU2VxdWVuY2VcIilcblxuICBsZXQgaW5pdGlhbCA9IDFcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgbGV0IGFsaWFzZXMgPSBbXVxuICAvKiogQHR5cGUge2ltcG9ydChcIi4vc2VxdWVuY2UuanNcIikuU2VxdWVuY2VGb3JtYXR0ZXIgfCB1bmRlZmluZWR9ICovXG4gIGxldCBmb3JtYXR0ZXJcblxuICBmb3IgKGNvbnN0IGFyZyBvZiBhcmdzKSB7XG4gICAgaWYgKHR5cGVvZiBhcmcgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgZm9ybWF0dGVyID0gYXJnXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYXJnID09PSBcIm51bWJlclwiKSB7XG4gICAgICBpbml0aWFsID0gYXJnXG4gICAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KGFyZykpIHtcbiAgICAgIGlmICh0eXBlb2YgYXJnLmluaXRpYWwgPT09IFwibnVtYmVyXCIpIGluaXRpYWwgPSBhcmcuaW5pdGlhbFxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXJnLmFsaWFzZXMpKSBhbGlhc2VzID0gYXJnLmFsaWFzZXNcbiAgICB9IGVsc2UgaWYgKGFyZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZERlZmluaXRpb25FcnJvcihgSW52YWxpZCBzZXF1ZW5jZSBhcmd1bWVudCBmb3IgXCIke25hbWV9XCI6ICR7U3RyaW5nKGFyZyl9YClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFNlcXVlbmNlKHtuYW1lLCBpbml0aWFsLCBmb3JtYXR0ZXIsIGFsaWFzZXN9KVxufVxuXG4vKipcbiAqIENvbGxlY3RzIGRlY2xhcmF0aW9ucyBmb3Igb25lIGZhY3RvcnkvdHJhaXQgYmxvY2suIFNoYXJlZCBieSBmYWN0b3J5IGJsb2NrcyxcbiAqIHRyYWl0IGJsb2NrcyBhbmQgdGhlIHJvb3QgcmVnaXN0cnktZGVmYXVsdHMgYmxvY2suXG4gKi9cbmNsYXNzIERlY2xhcmF0aW9uQ29sbGVjdG9yIHtcbiAgLyoqIEJ1aWxkcyBhIGNvbGxlY3Rvci4gKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5EZWNsYXJhdGlvbltdfSAtIE9yZGVyZWQgZGVjbGFyYXRpb25zLiAqL1xuICAgIHRoaXMuZGVjbGFyYXRpb25zID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgbGl0ZXJhbC9sYXp5IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBMaXRlcmFsIHZhbHVlIG9yIGxhenkgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXR0cmlidXRlKG5hbWUsIHZhbHVlKSB7XG4gICAgYXNzZXJ0TmFtZShuYW1lLCBcIkF0dHJpYnV0ZVwiKVxuICAgIHRoaXMuZGVjbGFyYXRpb25zLnB1c2goYXR0cmlidXRlRGVjbGFyYXRpb24obmFtZSwgdmFsdWUsIGZhbHNlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgdHJhbnNpZW50IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBUcmFuc2llbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBMaXRlcmFsIHZhbHVlIG9yIGxhenkgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdHJhbnNpZW50KG5hbWUsIHZhbHVlKSB7XG4gICAgYXNzZXJ0TmFtZShuYW1lLCBcIlRyYW5zaWVudFwiKVxuICAgIHRoaXMuZGVjbGFyYXRpb25zLnB1c2goYXR0cmlidXRlRGVjbGFyYXRpb24obmFtZSwgdmFsdWUsIHRydWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gYXNzb2NpYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gVHJhaXRzIGFuZC9vciBhbiBvcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NvY2lhdGlvbihuYW1lLCAuLi5hcmdzKSB7XG4gICAgYXNzZXJ0TmFtZShuYW1lLCBcIkFzc29jaWF0aW9uXCIpXG4gICAgdGhpcy5kZWNsYXJhdGlvbnMucHVzaChidWlsZEFzc29jaWF0aW9uRGVjbGFyYXRpb24obmFtZSwgYXJncykpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGJlZm9yZS1jYWxsYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBoYXNlIC0gUGhhc2UgKGFsbC9idWlsZC9jcmVhdGUpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGVjbGFyYXRpb25zLmpzXCIpLkNhbGxiYWNrRGVjbGFyYXRpb25bXCJmblwiXX0gZm4gLSBDYWxsYmFjayBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJlZm9yZShwaGFzZSwgZm4pIHtcbiAgICB0aGlzLmRlY2xhcmF0aW9ucy5wdXNoKGNhbGxiYWNrRGVjbGFyYXRpb24oZXZlbnROYW1lRm9yKFwiYmVmb3JlXCIsIHBoYXNlKSwgZm4pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gYWZ0ZXItY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwaGFzZSAtIFBoYXNlIChhbGwvYnVpbGQvY3JlYXRlKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5DYWxsYmFja0RlY2xhcmF0aW9uW1wiZm5cIl19IGZuIC0gQ2FsbGJhY2sgYm9keS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZnRlcihwaGFzZSwgZm4pIHtcbiAgICB0aGlzLmRlY2xhcmF0aW9ucy5wdXNoKGNhbGxiYWNrRGVjbGFyYXRpb24oZXZlbnROYW1lRm9yKFwiYWZ0ZXJcIiwgcGhhc2UpLCBmbikpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGN1c3RvbSBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5Jbml0aWFsaXplV2l0aERlY2xhcmF0aW9uW1wiZm5cIl19IGZuIC0gQ29uc3RydWN0b3IgYm9keS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBpbml0aWFsaXplV2l0aChmbikge1xuICAgIHRoaXMuZGVjbGFyYXRpb25zLnB1c2goaW5pdGlhbGl6ZVdpdGhEZWNsYXJhdGlvbihmbikpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGN1c3RvbSBwZXJzaXN0ZW5jZSBob29rLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGVjbGFyYXRpb25zLmpzXCIpLlRvQ3JlYXRlRGVjbGFyYXRpb25bXCJmblwiXX0gZm4gLSBQZXJzaXN0ZW5jZSBib2R5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHRvQ3JlYXRlKGZuKSB7XG4gICAgdGhpcy5kZWNsYXJhdGlvbnMucHVzaCh0b0NyZWF0ZURlY2xhcmF0aW9uKGZuKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHRoYXQgcGVyc2lzdGVuY2Ugc2hvdWxkIGJlIHNraXBwZWQgZm9yIHRoZSBjcmVhdGUgc3RyYXRlZ3kuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2tpcENyZWF0ZSgpIHtcbiAgICB0aGlzLmRlY2xhcmF0aW9ucy5wdXNoKHNraXBDcmVhdGVEZWNsYXJhdGlvbigpKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhIHRyYWl0IGJsb2NrIGFnYWluc3QgYSBmcmVzaCBjb2xsZWN0b3IgYW5kIGNvbXBpbGVzIGl0IGludG8gYSBkZWZpbml0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBUcmFpdCBuYW1lLlxuICogQHBhcmFtIHsoYnVpbGRlcjogb2JqZWN0KSA9PiB2b2lkfSBjYWxsYmFjayAtIFRyYWl0IGJ1aWxkZXIgY2FsbGJhY2suXG4gKiBAcmV0dXJucyB7VHJhaXREZWZpbml0aW9ufSAtIENvbXBpbGVkIHRyYWl0LlxuICovXG5mdW5jdGlvbiBjb21waWxlVHJhaXQobmFtZSwgY2FsbGJhY2spIHtcbiAgYXNzZXJ0TmFtZShuYW1lLCBcIlRyYWl0XCIpXG5cbiAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWREZWZpbml0aW9uRXJyb3IoYFRyYWl0IFwiJHtuYW1lfVwiIHJlcXVpcmVzIGEgYnVpbGRlciBmdW5jdGlvbmApXG4gIH1cblxuICBjb25zdCBjb2xsZWN0b3IgPSBuZXcgRGVjbGFyYXRpb25Db2xsZWN0b3IoKVxuICBjb25zdCBidWlsZGVyID0ge1xuICAgIGF0dHJpYnV0ZTogKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBhdHRyTmFtZSwgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gdmFsdWUpID0+IGNvbGxlY3Rvci5hdHRyaWJ1dGUoYXR0ck5hbWUsIHZhbHVlKSxcbiAgICB0cmFuc2llbnQ6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gYXR0ck5hbWUsIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIHZhbHVlKSA9PiBjb2xsZWN0b3IudHJhbnNpZW50KGF0dHJOYW1lLCB2YWx1ZSksXG4gICAgYXNzb2NpYXRpb246ICgvKiogQHR5cGUge3N0cmluZ30gKi8gYXNzb2NOYW1lLCAvKiogQHR5cGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gLi4uYXJncykgPT4gY29sbGVjdG9yLmFzc29jaWF0aW9uKGFzc29jTmFtZSwgLi4uYXJncyksXG4gICAgYmVmb3JlOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHBoYXNlLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT4gY29sbGVjdG9yLmJlZm9yZShwaGFzZSwgZm4pLFxuICAgIGFmdGVyOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHBoYXNlLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT4gY29sbGVjdG9yLmFmdGVyKHBoYXNlLCBmbiksXG4gICAgaW5pdGlhbGl6ZVdpdGg6ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT4gY29sbGVjdG9yLmluaXRpYWxpemVXaXRoKGZuKSxcbiAgICB0b0NyZWF0ZTogKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGZuKSA9PiBjb2xsZWN0b3IudG9DcmVhdGUoZm4pLFxuICAgIHNraXBDcmVhdGU6ICgpID0+IGNvbGxlY3Rvci5za2lwQ3JlYXRlKCksXG4gICAgdHJhaXQ6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gaW5jbHVkZU5hbWUpID0+IHtcbiAgICAgIGFzc2VydE5hbWUoaW5jbHVkZU5hbWUsIFwiVHJhaXQgaW5jbHVkZVwiKVxuICAgICAgY29sbGVjdG9yLmRlY2xhcmF0aW9ucy5wdXNoKHRyYWl0SW5jbHVkZURlY2xhcmF0aW9uKGluY2x1ZGVOYW1lKSlcbiAgICB9XG4gIH1cblxuICBjYWxsYmFjayhidWlsZGVyKVxuXG4gIHJldHVybiBuZXcgVHJhaXREZWZpbml0aW9uKHtuYW1lLCBkZWNsYXJhdGlvbnM6IGNvbGxlY3Rvci5kZWNsYXJhdGlvbnN9KVxufVxuXG4vKipcbiAqIEEgc2luZ2xlIGBkZWZpbmVgL2Btb2RpZnlgIHNlc3Npb24uIEl0IHdhbGtzIHRoZSBidWlsZGVyIGNhbGxiYWNrcywgY29tcGlsZXNcbiAqIGltbXV0YWJsZSBkZWZpbml0aW9ucyBhbmQgcmVnaXN0ZXJzIHRoZW0gaW50byB0aGUgdGFyZ2V0IHJlZ2lzdHJ5LCB0aHJvd2luZyBvblxuICogZHVwbGljYXRlIG9yIHN0cnVjdHVyYWxseSBpbnZhbGlkIGRlY2xhcmF0aW9ucyBhdCBkZWZpbml0aW9uIHRpbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIERlZmluaXRpb25TZXNzaW9uIHtcbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHNlc3Npb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LXJlZ2lzdHJ5LmpzXCIpLmRlZmF1bHR9IHJlZ2lzdHJ5IC0gVGFyZ2V0IHJlZ2lzdHJ5LlxuICAgKi9cbiAgY29uc3RydWN0b3IocmVnaXN0cnkpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vZmFjdG9yeS1yZWdpc3RyeS5qc1wiKS5kZWZhdWx0fSAtIFRhcmdldCByZWdpc3RyeS4gKi9cbiAgICB0aGlzLnJlZ2lzdHJ5ID0gcmVnaXN0cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcm9vdCBgZGVmaW5lYCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsoYnVpbGRlcjogb2JqZWN0KSA9PiB2b2lkfSBjYWxsYmFjayAtIFJvb3QgYnVpbGRlciBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBydW4oY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRGVmaW5pdGlvbkVycm9yKFwiZGVmaW5lIHJlcXVpcmVzIGEgYnVpbGRlciBjYWxsYmFja1wiKVxuICAgIH1cblxuICAgIGNhbGxiYWNrKHRoaXMuX3Jvb3RCdWlsZGVyKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGBtb2RpZnlgIGNhbGxiYWNrIHRoYXQgcmVvcGVucyBleGlzdGluZyBmYWN0b3JpZXMgdG8gYXBwZW5kL292ZXJyaWRlXG4gICAqIGRlY2xhcmF0aW9ucywgcmVjb21waWxpbmcgZWFjaCBpbnRvIGEgZnJlc2ggaW1tdXRhYmxlIGRlZmluaXRpb24gcmF0aGVyIHRoYW5cbiAgICogbXV0YXRpbmcgdGhlIG9yaWdpbmFsLlxuICAgKiBAcGFyYW0geyhidWlsZGVyOiBvYmplY3QpID0+IHZvaWR9IGNhbGxiYWNrIC0gTW9kaWZ5IGJ1aWxkZXIgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcnVuTW9kaWZ5KGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZERlZmluaXRpb25FcnJvcihcIm1vZGlmeSByZXF1aXJlcyBhIGJ1aWxkZXIgY2FsbGJhY2tcIilcbiAgICB9XG5cbiAgICBjYWxsYmFjayh0aGlzLl9tb2RpZnlCdWlsZGVyKCkpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBidWlsZGVyIG9iamVjdCBleHBvc2VkIHRvIGBtb2RpZnlgLlxuICAgKiBAcmV0dXJucyB7b2JqZWN0fSAtIE1vZGlmeSBidWlsZGVyLlxuICAgKi9cbiAgX21vZGlmeUJ1aWxkZXIoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGZhY3Rvcnk6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gbmFtZSwgLyoqIEB0eXBlIHsoYnVpbGRlcjogb2JqZWN0KSA9PiB2b2lkfSAqLyBjYikgPT4gdGhpcy5fbW9kaWZ5RmFjdG9yeShuYW1lLCBjYiksXG4gICAgICB0cmFpdDogKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBuYW1lLCAvKiogQHR5cGUgeyhidWlsZGVyOiBvYmplY3QpID0+IHZvaWR9ICovIGNiKSA9PlxuICAgICAgICB0aGlzLnJlZ2lzdHJ5Ll9yZWdpc3Rlckdsb2JhbFRyYWl0KGNvbXBpbGVUcmFpdChuYW1lLCBjYikpLFxuICAgICAgc2VxdWVuY2U6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gbmFtZSwgLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIC4uLmFyZ3MpID0+XG4gICAgICAgIHRoaXMucmVnaXN0cnkuX3JlZ2lzdGVyU2VxdWVuY2UoYnVpbGRTZXF1ZW5jZShuYW1lLCBhcmdzKSwgbnVsbCksXG4gICAgICBiZWZvcmU6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gcGhhc2UsIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGZuKSA9PlxuICAgICAgICB0aGlzLnJlZ2lzdHJ5Ll9hZGRHbG9iYWxEZWNsYXJhdGlvbihjYWxsYmFja0RlY2xhcmF0aW9uKGV2ZW50TmFtZUZvcihcImJlZm9yZVwiLCBwaGFzZSksIGZuKSksXG4gICAgICBhZnRlcjogKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBwaGFzZSwgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gZm4pID0+XG4gICAgICAgIHRoaXMucmVnaXN0cnkuX2FkZEdsb2JhbERlY2xhcmF0aW9uKGNhbGxiYWNrRGVjbGFyYXRpb24oZXZlbnROYW1lRm9yKFwiYWZ0ZXJcIiwgcGhhc2UpLCBmbikpLFxuICAgICAgaW5pdGlhbGl6ZVdpdGg6ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT4gdGhpcy5yZWdpc3RyeS5fYWRkR2xvYmFsRGVjbGFyYXRpb24oaW5pdGlhbGl6ZVdpdGhEZWNsYXJhdGlvbihmbikpLFxuICAgICAgdG9DcmVhdGU6ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT4gdGhpcy5yZWdpc3RyeS5fYWRkR2xvYmFsRGVjbGFyYXRpb24odG9DcmVhdGVEZWNsYXJhdGlvbihmbikpLFxuICAgICAgc2tpcENyZWF0ZTogKCkgPT4gdGhpcy5yZWdpc3RyeS5fYWRkR2xvYmFsRGVjbGFyYXRpb24oc2tpcENyZWF0ZURlY2xhcmF0aW9uKCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29tcGlsZXMgYW4gZXhpc3RpbmcgZmFjdG9yeSB3aXRoIGFwcGVuZGVkIGRlY2xhcmF0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBFeGlzdGluZyBmYWN0b3J5IG5hbWUuXG4gICAqIEBwYXJhbSB7KGJ1aWxkZXI6IG9iamVjdCkgPT4gdm9pZH0gY2IgLSBGYWN0b3J5IGJ1aWxkZXIgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX21vZGlmeUZhY3RvcnkobmFtZSwgY2IpIHtcbiAgICBhc3NlcnROYW1lKG5hbWUsIFwiRmFjdG9yeVwiKVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnJlZ2lzdHJ5Ll9mYWN0b3JpZXMuZ2V0KG5hbWUpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZERlZmluaXRpb25FcnJvcihgQ2Fubm90IG1vZGlmeSB1bmtub3duIGZhY3RvcnkgXCIke25hbWV9XCJgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbGxlY3RvciA9IG5ldyBEZWNsYXJhdGlvbkNvbGxlY3RvcigpXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7bmFtZTogc3RyaW5nLCBtb2RlbE9yT3B0aW9uczogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNiOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIGNvbnN0IG5lc3RlZEZhY3RvcmllcyA9IFtdXG4gICAgY29uc3QgbG9jYWxUcmFpdHMgPSBuZXcgTWFwKGV4aXN0aW5nLmxvY2FsVHJhaXRzKVxuICAgIC8qKiBAdHlwZSB7U2VxdWVuY2VbXX0gKi9cbiAgICBjb25zdCBzY29wZWRTZXF1ZW5jZXMgPSBbXVxuXG4gICAgaWYgKHR5cGVvZiBjYiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjYih0aGlzLl9mYWN0b3J5QnVpbGRlcihjb2xsZWN0b3IsIG5lc3RlZEZhY3RvcmllcywgbG9jYWxUcmFpdHMsIHNjb3BlZFNlcXVlbmNlcykpXG4gICAgfVxuXG4gICAgY29uc3QgbWVyZ2VkID0gbmV3IEZhY3RvcnlEZWZpbml0aW9uKHtcbiAgICAgIG5hbWU6IGV4aXN0aW5nLm5hbWUsXG4gICAgICBtb2RlbENsYXNzOiBleGlzdGluZy5tb2RlbENsYXNzLFxuICAgICAgcGFyZW50TmFtZTogZXhpc3RpbmcucGFyZW50TmFtZSxcbiAgICAgIGFsaWFzZXM6IFsuLi5leGlzdGluZy5hbGlhc2VzXSxcbiAgICAgIGRlY2xhcmF0aW9uczogWy4uLmV4aXN0aW5nLmRlY2xhcmF0aW9ucywgLi4uY29sbGVjdG9yLmRlY2xhcmF0aW9uc10sXG4gICAgICBsb2NhbFRyYWl0c1xuICAgIH0pXG5cbiAgICB0aGlzLnJlZ2lzdHJ5Ll9yZXBsYWNlRmFjdG9yeURlZmluaXRpb24obWVyZ2VkKVxuXG4gICAgZm9yIChjb25zdCBzZXF1ZW5jZSBvZiBzY29wZWRTZXF1ZW5jZXMpIHtcbiAgICAgIHRoaXMucmVnaXN0cnkuX3JlZ2lzdGVyU2VxdWVuY2Uoc2VxdWVuY2UsIG5hbWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBuZXN0ZWQgb2YgbmVzdGVkRmFjdG9yaWVzKSB7XG4gICAgICB0aGlzLl9kZWZpbmVGYWN0b3J5KG5lc3RlZC5uYW1lLCBuZXN0ZWQubW9kZWxPck9wdGlvbnMsIG5lc3RlZC5jYiwgbmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSByb290IGJ1aWxkZXIgb2JqZWN0IGV4cG9zZWQgdG8gYGRlZmluZWAuXG4gICAqIEByZXR1cm5zIHtvYmplY3R9IC0gUm9vdCBidWlsZGVyLlxuICAgKi9cbiAgX3Jvb3RCdWlsZGVyKCkge1xuICAgIHJldHVybiB7XG4gICAgICBmYWN0b3J5OiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIG5hbWUsIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG1vZGVsT3JPcHRpb25zLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBjYikgPT5cbiAgICAgICAgdGhpcy5fZGVmaW5lRmFjdG9yeShuYW1lLCBtb2RlbE9yT3B0aW9ucywgY2IsIG51bGwpLFxuICAgICAgdHJhaXQ6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gbmFtZSwgLyoqIEB0eXBlIHsoYnVpbGRlcjogb2JqZWN0KSA9PiB2b2lkfSAqLyBjYikgPT5cbiAgICAgICAgdGhpcy5yZWdpc3RyeS5fcmVnaXN0ZXJHbG9iYWxUcmFpdChjb21waWxlVHJhaXQobmFtZSwgY2IpKSxcbiAgICAgIHNlcXVlbmNlOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIG5hbWUsIC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAuLi5hcmdzKSA9PlxuICAgICAgICB0aGlzLnJlZ2lzdHJ5Ll9yZWdpc3RlclNlcXVlbmNlKGJ1aWxkU2VxdWVuY2UobmFtZSwgYXJncyksIG51bGwpLFxuICAgICAgYmVmb3JlOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHBoYXNlLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT5cbiAgICAgICAgdGhpcy5yZWdpc3RyeS5fYWRkR2xvYmFsRGVjbGFyYXRpb24oY2FsbGJhY2tEZWNsYXJhdGlvbihldmVudE5hbWVGb3IoXCJiZWZvcmVcIiwgcGhhc2UpLCBmbikpLFxuICAgICAgYWZ0ZXI6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gcGhhc2UsIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGZuKSA9PlxuICAgICAgICB0aGlzLnJlZ2lzdHJ5Ll9hZGRHbG9iYWxEZWNsYXJhdGlvbihjYWxsYmFja0RlY2xhcmF0aW9uKGV2ZW50TmFtZUZvcihcImFmdGVyXCIsIHBoYXNlKSwgZm4pKSxcbiAgICAgIGluaXRpYWxpemVXaXRoOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gZm4pID0+IHRoaXMucmVnaXN0cnkuX2FkZEdsb2JhbERlY2xhcmF0aW9uKGluaXRpYWxpemVXaXRoRGVjbGFyYXRpb24oZm4pKSxcbiAgICAgIHRvQ3JlYXRlOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gZm4pID0+IHRoaXMucmVnaXN0cnkuX2FkZEdsb2JhbERlY2xhcmF0aW9uKHRvQ3JlYXRlRGVjbGFyYXRpb24oZm4pKSxcbiAgICAgIHNraXBDcmVhdGU6ICgpID0+IHRoaXMucmVnaXN0cnkuX2FkZEdsb2JhbERlY2xhcmF0aW9uKHNraXBDcmVhdGVEZWNsYXJhdGlvbigpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb21waWxlcyBhbmQgcmVnaXN0ZXJzIGEgZmFjdG9yeSAoYW5kIGl0cyBuZXN0ZWQgY2hpbGRyZW4vbG9jYWwgdHJhaXRzL3Njb3BlZFxuICAgKiBzZXF1ZW5jZXMpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEZhY3RvcnkgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbW9kZWxPck9wdGlvbnMgLSBNb2RlbCBjbGFzcyBvciBvcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2IgLSBGYWN0b3J5IGJ1aWxkZXIgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gaW5oZXJpdGVkUGFyZW50IC0gUGFyZW50IG5hbWUgZm9yIG5lc3RlZCBmYWN0b3JpZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2RlZmluZUZhY3RvcnkobmFtZSwgbW9kZWxPck9wdGlvbnMsIGNiLCBpbmhlcml0ZWRQYXJlbnQpIHtcbiAgICBhc3NlcnROYW1lKG5hbWUsIFwiRmFjdG9yeVwiKVxuXG4gICAgbGV0IG1vZGVsQ2xhc3MgPSBudWxsXG4gICAgbGV0IGJ1aWxkZXJDYWxsYmFjayA9IGNiXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IG9wdGlvbnMgPSB7fVxuXG4gICAgaWYgKHR5cGVvZiBjYiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBUaHJlZS1hcmd1bWVudCBmb3JtOiB0aGUgc2Vjb25kIGFyZ3VtZW50IGlzIHRoZSBtb2RlbCBjbGFzcyBvciBvcHRpb25zLlxuICAgICAgaWYgKHR5cGVvZiBtb2RlbE9yT3B0aW9ucyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIG1vZGVsQ2xhc3MgPSBtb2RlbE9yT3B0aW9uc1xuICAgICAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KG1vZGVsT3JPcHRpb25zKSkge1xuICAgICAgICBvcHRpb25zID0gbW9kZWxPck9wdGlvbnNcbiAgICAgICAgbW9kZWxDbGFzcyA9IG9wdGlvbnMubW9kZWwgfHwgb3B0aW9ucy5jbGFzcyB8fCBudWxsXG4gICAgICB9IGVsc2UgaWYgKG1vZGVsT3JPcHRpb25zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWREZWZpbml0aW9uRXJyb3IoYEZhY3RvcnkgXCIke25hbWV9XCIgbW9kZWwgbXVzdCBiZSBhIGNsYXNzIG9yIGFuIG9wdGlvbnMgb2JqZWN0YClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBtb2RlbE9yT3B0aW9ucyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBUd28tYXJndW1lbnQgZm9ybSB3aXRoIGEgdHJhaWxpbmcgZnVuY3Rpb24uIEEgYmFja2VuZCBtb2RlbCBjbGFzcyBtZWFuc1xuICAgICAgLy8gXCJubyBidWlsZGVyXCI7IGFueSBvdGhlciBmdW5jdGlvbiBpcyB0aGUgYnVpbGRlciAoY2hpbGQgaW5oZXJpdHMgaXRzIG1vZGVsKS5cbiAgICAgIGlmIChtb2RlbE9yT3B0aW9ucy5wcm90b3R5cGUgaW5zdGFuY2VvZiBEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICBtb2RlbENsYXNzID0gbW9kZWxPck9wdGlvbnNcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJ1aWxkZXJDYWxsYmFjayA9IG1vZGVsT3JPcHRpb25zXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KG1vZGVsT3JPcHRpb25zKSkge1xuICAgICAgb3B0aW9ucyA9IG1vZGVsT3JPcHRpb25zXG4gICAgICBtb2RlbENsYXNzID0gb3B0aW9ucy5tb2RlbCB8fCBvcHRpb25zLmNsYXNzIHx8IG51bGxcbiAgICB9IGVsc2UgaWYgKG1vZGVsT3JPcHRpb25zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRGVmaW5pdGlvbkVycm9yKGBGYWN0b3J5IFwiJHtuYW1lfVwiIG1vZGVsIG11c3QgYmUgYSBjbGFzcyBvciBhbiBvcHRpb25zIG9iamVjdGApXG4gICAgfVxuXG4gICAgY29uc3QgcGFyZW50TmFtZSA9IG9wdGlvbnMucGFyZW50IHx8IGluaGVyaXRlZFBhcmVudCB8fCBudWxsXG4gICAgY29uc3QgYWxpYXNlcyA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5hbGlhc2VzKSA/IG9wdGlvbnMuYWxpYXNlcyA6IFtdXG4gICAgY29uc3QgYmFzZVRyYWl0cyA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy50cmFpdHMpID8gb3B0aW9ucy50cmFpdHMgOiBbXVxuXG4gICAgY29uc3QgY29sbGVjdG9yID0gbmV3IERlY2xhcmF0aW9uQ29sbGVjdG9yKClcbiAgICAvKiogQHR5cGUge0FycmF5PHtuYW1lOiBzdHJpbmcsIG1vZGVsT3JPcHRpb25zOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY2I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgY29uc3QgbmVzdGVkRmFjdG9yaWVzID0gW11cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFRyYWl0RGVmaW5pdGlvbj59ICovXG4gICAgY29uc3QgbG9jYWxUcmFpdHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NlcXVlbmNlW119ICovXG4gICAgY29uc3Qgc2NvcGVkU2VxdWVuY2VzID0gW11cblxuICAgIGlmICh0eXBlb2YgYnVpbGRlckNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGJ1aWxkZXJDYWxsYmFjayh0aGlzLl9mYWN0b3J5QnVpbGRlcihjb2xsZWN0b3IsIG5lc3RlZEZhY3RvcmllcywgbG9jYWxUcmFpdHMsIHNjb3BlZFNlcXVlbmNlcykpXG4gICAgfVxuXG4gICAgY29uc3QgZGVjbGFyYXRpb25zID0gWy4uLmJhc2VUcmFpdHMubWFwKCh0cmFpdE5hbWUpID0+IHRyYWl0SW5jbHVkZURlY2xhcmF0aW9uKHRyYWl0TmFtZSkpLCAuLi5jb2xsZWN0b3IuZGVjbGFyYXRpb25zXVxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBuZXcgRmFjdG9yeURlZmluaXRpb24oe25hbWUsIG1vZGVsQ2xhc3MsIHBhcmVudE5hbWUsIGFsaWFzZXMsIGRlY2xhcmF0aW9ucywgbG9jYWxUcmFpdHN9KVxuXG4gICAgdGhpcy5yZWdpc3RyeS5fcmVnaXN0ZXJGYWN0b3J5RGVmaW5pdGlvbihkZWZpbml0aW9uKVxuXG4gICAgZm9yIChjb25zdCBzZXF1ZW5jZSBvZiBzY29wZWRTZXF1ZW5jZXMpIHtcbiAgICAgIHRoaXMucmVnaXN0cnkuX3JlZ2lzdGVyU2VxdWVuY2Uoc2VxdWVuY2UsIG5hbWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBuZXN0ZWQgb2YgbmVzdGVkRmFjdG9yaWVzKSB7XG4gICAgICB0aGlzLl9kZWZpbmVGYWN0b3J5KG5lc3RlZC5uYW1lLCBuZXN0ZWQubW9kZWxPck9wdGlvbnMsIG5lc3RlZC5jYiwgbmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBmYWN0b3J5IGJ1aWxkZXIgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0RlY2xhcmF0aW9uQ29sbGVjdG9yfSBjb2xsZWN0b3IgLSBEZWNsYXJhdGlvbiBjb2xsZWN0b3IuXG4gICAqIEBwYXJhbSB7QXJyYXk8e25hbWU6IHN0cmluZywgbW9kZWxPck9wdGlvbnM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjYjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gbmVzdGVkRmFjdG9yaWVzIC0gTmVzdGVkIGZhY3Rvcnkgc2luay5cbiAgICogQHBhcmFtIHtNYXA8c3RyaW5nLCBUcmFpdERlZmluaXRpb24+fSBsb2NhbFRyYWl0cyAtIExvY2FsIHRyYWl0IHNpbmsuXG4gICAqIEBwYXJhbSB7U2VxdWVuY2VbXX0gc2NvcGVkU2VxdWVuY2VzIC0gU2NvcGVkIHNlcXVlbmNlIHNpbmsuXG4gICAqIEByZXR1cm5zIHtvYmplY3R9IC0gRmFjdG9yeSBidWlsZGVyLlxuICAgKi9cbiAgX2ZhY3RvcnlCdWlsZGVyKGNvbGxlY3RvciwgbmVzdGVkRmFjdG9yaWVzLCBsb2NhbFRyYWl0cywgc2NvcGVkU2VxdWVuY2VzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGF0dHJpYnV0ZTogKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBhdHRyTmFtZSwgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gdmFsdWUpID0+IGNvbGxlY3Rvci5hdHRyaWJ1dGUoYXR0ck5hbWUsIHZhbHVlKSxcbiAgICAgIHRyYW5zaWVudDogKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBhdHRyTmFtZSwgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gdmFsdWUpID0+IGNvbGxlY3Rvci50cmFuc2llbnQoYXR0ck5hbWUsIHZhbHVlKSxcbiAgICAgIGFzc29jaWF0aW9uOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIGFzc29jTmFtZSwgLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIC4uLmFyZ3MpID0+IGNvbGxlY3Rvci5hc3NvY2lhdGlvbihhc3NvY05hbWUsIC4uLmFyZ3MpLFxuICAgICAgYmVmb3JlOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHBoYXNlLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBmbikgPT4gY29sbGVjdG9yLmJlZm9yZShwaGFzZSwgZm4pLFxuICAgICAgYWZ0ZXI6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gcGhhc2UsIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGZuKSA9PiBjb2xsZWN0b3IuYWZ0ZXIocGhhc2UsIGZuKSxcbiAgICAgIGluaXRpYWxpemVXaXRoOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gZm4pID0+IGNvbGxlY3Rvci5pbml0aWFsaXplV2l0aChmbiksXG4gICAgICB0b0NyZWF0ZTogKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGZuKSA9PiBjb2xsZWN0b3IudG9DcmVhdGUoZm4pLFxuICAgICAgc2tpcENyZWF0ZTogKCkgPT4gY29sbGVjdG9yLnNraXBDcmVhdGUoKSxcbiAgICAgIHNlcXVlbmNlOiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHNlcU5hbWUsIC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAuLi5hcmdzKSA9PiBzY29wZWRTZXF1ZW5jZXMucHVzaChidWlsZFNlcXVlbmNlKHNlcU5hbWUsIGFyZ3MpKSxcbiAgICAgIHRyYWl0OiAoLyoqIEB0eXBlIHtzdHJpbmd9ICovIHRyYWl0TmFtZSwgLyoqIEB0eXBlIHsoKGJ1aWxkZXI6IG9iamVjdCkgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovIHRyYWl0Q2IpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiB0cmFpdENiID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICBjb25zdCBjb21waWxlZCA9IGNvbXBpbGVUcmFpdCh0cmFpdE5hbWUsIHRyYWl0Q2IpXG5cbiAgICAgICAgICBpZiAobG9jYWxUcmFpdHMuaGFzKHRyYWl0TmFtZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkRGVmaW5pdGlvbkVycm9yKGBMb2NhbCB0cmFpdCBcIiR7dHJhaXROYW1lfVwiIGlzIGFscmVhZHkgZGVmaW5lZCBvbiB0aGlzIGZhY3RvcnlgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGxvY2FsVHJhaXRzLnNldCh0cmFpdE5hbWUsIGNvbXBpbGVkKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFzc2VydE5hbWUodHJhaXROYW1lLCBcIlRyYWl0IGluY2x1ZGVcIilcbiAgICAgICAgICBjb2xsZWN0b3IuZGVjbGFyYXRpb25zLnB1c2godHJhaXRJbmNsdWRlRGVjbGFyYXRpb24odHJhaXROYW1lKSlcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGZhY3Rvcnk6ICgvKiogQHR5cGUge3N0cmluZ30gKi8gY2hpbGROYW1lLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBjaGlsZE1vZGVsT3JPcHRpb25zLCAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBjaGlsZENiKSA9PlxuICAgICAgICBuZXN0ZWRGYWN0b3JpZXMucHVzaCh7bmFtZTogY2hpbGROYW1lLCBtb2RlbE9yT3B0aW9uczogY2hpbGRNb2RlbE9yT3B0aW9ucywgY2I6IGNoaWxkQ2J9KVxuICAgIH1cbiAgfVxufVxuIl19