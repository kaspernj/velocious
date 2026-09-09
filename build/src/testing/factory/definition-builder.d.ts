import Sequence from "./sequence.js";
import TraitDefinition from "./trait-definition.js";
/**
 * Collects declarations for one factory/trait block. Shared by factory blocks,
 * trait blocks and the root registry-defaults block.
 */
declare class DeclarationCollector {
    /** @type {import("./declarations.js").Declaration[]} - Ordered declarations. */
    declarations: import("./declarations.js").Declaration[];
    /** Builds a collector. */
    constructor();
    /**
     * Records a literal/lazy attribute.
     * @param {string} name - Attribute name.
     * @param {ReturnType<typeof JSON.parse>} value - Literal value or lazy function.
     * @returns {void}
     */
    attribute(name: string, value: ReturnType<typeof JSON.parse>): void;
    /**
     * Records a transient attribute.
     * @param {string} name - Transient name.
     * @param {ReturnType<typeof JSON.parse>} value - Literal value or lazy function.
     * @returns {void}
     */
    transient(name: string, value: ReturnType<typeof JSON.parse>): void;
    /**
     * Records an association.
     * @param {string} name - Relationship name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Traits and/or an options object.
     * @returns {void}
     */
    association(name: string, ...args: Array<ReturnType<typeof JSON.parse>>): void;
    /**
     * Records a before-callback.
     * @param {string} phase - Phase (all/build/create).
     * @param {import("./declarations.js").CallbackDeclaration["fn"]} fn - Callback body.
     * @returns {void}
     */
    before(phase: string, fn: import("./declarations.js").CallbackDeclaration["fn"]): void;
    /**
     * Records an after-callback.
     * @param {string} phase - Phase (all/build/create).
     * @param {import("./declarations.js").CallbackDeclaration["fn"]} fn - Callback body.
     * @returns {void}
     */
    after(phase: string, fn: import("./declarations.js").CallbackDeclaration["fn"]): void;
    /**
     * Records a custom constructor.
     * @param {import("./declarations.js").InitializeWithDeclaration["fn"]} fn - Constructor body.
     * @returns {void}
     */
    initializeWith(fn: import("./declarations.js").InitializeWithDeclaration["fn"]): void;
    /**
     * Records a custom persistence hook.
     * @param {import("./declarations.js").ToCreateDeclaration["fn"]} fn - Persistence body.
     * @returns {void}
     */
    toCreate(fn: import("./declarations.js").ToCreateDeclaration["fn"]): void;
    /**
     * Records that persistence should be skipped for the create strategy.
     * @returns {void}
     */
    skipCreate(): void;
}
/**
 * A single `define`/`modify` session. It walks the builder callbacks, compiles
 * immutable definitions and registers them into the target registry, throwing on
 * duplicate or structurally invalid declarations at definition time.
 */
export default class DefinitionSession {
    /** @type {import("./factory-registry.js").default} - Target registry. */
    registry: import("./factory-registry.js").default;
    /**
     * Builds a session.
     * @param {import("./factory-registry.js").default} registry - Target registry.
     */
    constructor(registry: import("./factory-registry.js").default);
    /**
     * Runs a root `define` callback.
     * @param {(builder: object) => void} callback - Root builder callback.
     * @returns {void}
     */
    run(callback: (builder: object) => void): void;
    /**
     * Runs a `modify` callback that reopens existing factories to append/override
     * declarations, recompiling each into a fresh immutable definition rather than
     * mutating the original.
     * @param {(builder: object) => void} callback - Modify builder callback.
     * @returns {void}
     */
    runModify(callback: (builder: object) => void): void;
    /**
     * Builds the builder object exposed to `modify`.
     * @returns {object} - Modify builder.
     */
    _modifyBuilder(): object;
    /**
     * Recompiles an existing factory with appended declarations.
     * @param {string} name - Existing factory name.
     * @param {(builder: object) => void} cb - Factory builder callback.
     * @returns {void}
     */
    _modifyFactory(name: string, cb: (builder: object) => void): void;
    /**
     * Builds the root builder object exposed to `define`.
     * @returns {object} - Root builder.
     */
    _rootBuilder(): object;
    /**
     * Compiles and registers a factory (and its nested children/local traits/scoped
     * sequences).
     * @param {string} name - Factory name.
     * @param {ReturnType<typeof JSON.parse>} modelOrOptions - Model class or options object.
     * @param {ReturnType<typeof JSON.parse>} cb - Factory builder callback.
     * @param {string | null} inheritedParent - Parent name for nested factories.
     * @returns {void}
     */
    _defineFactory(name: string, modelOrOptions: ReturnType<typeof JSON.parse>, cb: ReturnType<typeof JSON.parse>, inheritedParent: string | null): void;
    /**
     * Builds the factory builder object.
     * @param {DeclarationCollector} collector - Declaration collector.
     * @param {Array<{name: string, modelOrOptions: ReturnType<typeof JSON.parse>, cb: ReturnType<typeof JSON.parse>}>} nestedFactories - Nested factory sink.
     * @param {Map<string, TraitDefinition>} localTraits - Local trait sink.
     * @param {Sequence[]} scopedSequences - Scoped sequence sink.
     * @returns {object} - Factory builder.
     */
    _factoryBuilder(collector: DeclarationCollector, nestedFactories: Array<{
        name: string;
        modelOrOptions: ReturnType<typeof JSON.parse>;
        cb: ReturnType<typeof JSON.parse>;
    }>, localTraits: Map<string, TraitDefinition>, scopedSequences: Sequence[]): object;
}
export {};
//# sourceMappingURL=definition-builder.d.ts.map