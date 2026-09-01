import AttributesForStrategy from "./strategies/attributes-for.js";
import BuildStrategy from "./strategies/build.js";
import CreateStrategy from "./strategies/create.js";
import FactoryEventEmitter from "./events.js";
import FactoryRunner from "./factory-runner.js";
/**
 * Owns all factories, traits, sequences, callbacks and construction defaults for
 * one isolated scope, and exposes the strategy entry points. Registry mutation is
 * setup-time only and is rejected while evaluations are active.
 */
export default class FactoryRegistry {
    /** @type {Map<string, import("./factory-definition.js").default>} - Factories and aliases. */
    _factories: Map<string, import("./factory-definition.js").default>;
    /** @type {Map<string, import("./trait-definition.js").default>} - Global traits. */
    _globalTraits: Map<string, import("./trait-definition.js").default>;
    /** @type {Map<string, import("./sequence.js").default>} - Global sequences and aliases. */
    _sequences: Map<string, import("./sequence.js").default>;
    /** @type {Map<string, Map<string, import("./sequence.js").default>>} - Factory-scoped sequences. */
    _factorySequences: Map<string, Map<string, import("./sequence.js").default>>;
    /** @type {import("./declarations.js").Declaration[]} - Registry-level default declarations. */
    _globalDeclarations: import("./declarations.js").Declaration[];
    /** @type {number} - In-flight evaluation count (mutation guard). */
    _activeEvaluations: number;
    /** @type {FactoryRunner} - Plan compiler. */
    _runner: FactoryRunner;
    /** @type {FactoryEventEmitter} - Debug/performance event emitter. */
    _events: FactoryEventEmitter;
    /** @type {{attributesFor: AttributesForStrategy, build: BuildStrategy, create: CreateStrategy}} - Installed strategies. */
    _strategies: {
        attributesFor: AttributesForStrategy;
        build: BuildStrategy;
        create: CreateStrategy;
    };
    /** Builds an empty registry with the built-in strategies installed. */
    constructor();
    /**
     * Registers factories/traits/sequences/callbacks via a builder callback.
     * @param {(builder: object) => void} callback - The definition callback.
     * @returns {this} - This registry (for chaining).
     */
    define(callback: (builder: object) => void): this;
    /**
     * Reopens existing factories to append/override declarations, recompiling each
     * into a fresh immutable definition. Rejected while evaluations are active.
     * @param {(builder: object) => void} callback - The modify callback.
     * @returns {this} - This registry (for chaining).
     */
    modify(callback: (builder: object) => void): this;
    /**
     * Lints factories/traits, aggregating every failure. Create-strategy cases roll
     * back their database writes.
     * @param {object} [options] - Lint options (factories, traits, strategy).
     * @returns {Promise<void>} - Resolves when all cases pass; rejects with an aggregate otherwise.
     */
    lint(options?: object): Promise<void>;
    /**
     * Subscribes to factory debug events (`start`, `success`, `failure`).
     * @param {string} event - Event name.
     * @param {(payload: {invocationId: string, factory: string, strategy: string, traits: string[], durationMs?: number, error?: ReturnType<typeof JSON.parse>}) => void} handler - Event handler.
     * @returns {this} - This registry (for chaining).
     */
    on(event: string, handler: (payload: {
        invocationId: string;
        factory: string;
        strategy: string;
        traits: string[];
        durationMs?: number;
        error?: ReturnType<typeof JSON.parse>;
    }) => void): this;
    /**
     * Unsubscribes a previously-registered event handler.
     * @param {string} event - Event name.
     * @param {(payload: ReturnType<typeof JSON.parse>) => void} handler - Event handler to remove.
     * @returns {this} - This registry (for chaining).
     */
    off(event: string, handler: (payload: ReturnType<typeof JSON.parse>) => void): this;
    /**
     * Resolves attributes without constructing a model or building associations.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - The resolved attributes.
     */
    attributesFor(factoryName: string, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Builds an unsaved record graph.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The built record.
     */
    build(factoryName: string, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Builds and persists a record graph.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The persisted record.
     */
    create(factoryName: string, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Resolves attributes for a list of records sequentially.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of entries.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - The resolved attribute objects.
     */
    attributesForList(factoryName: string, count: number, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Builds a list of unsaved records sequentially.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of records.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The built records.
     */
    buildList(factoryName: string, count: number, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Creates a list of persisted records sequentially.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of records.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The persisted records.
     */
    createList(factoryName: string, count: number, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves attributes for exactly two records.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - The two resolved attribute objects.
     */
    attributesForPair(factoryName: string, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Builds exactly two unsaved records.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The two built records.
     */
    buildPair(factoryName: string, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Creates exactly two persisted records.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The two persisted records.
     */
    createPair(factoryName: string, ...args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Advances a sequence and returns its formatted value.
     * @param {string} sequenceName - Sequence name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The formatted value.
     */
    generate(sequenceName: string): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Advances a sequence `count` times and returns the formatted values.
     * @param {string} sequenceName - Sequence name.
     * @param {number} count - Number of values.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The formatted values.
     */
    generateList(sequenceName: string, count: number): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Returns the next raw value a global sequence would allocate without consuming it.
     * @param {string} sequenceName - Sequence name.
     * @returns {number} - The upcoming raw value.
     */
    peekSequence(sequenceName: string): number;
    /**
     * Sets the next value a global sequence will allocate.
     * @param {string} sequenceName - Sequence name.
     * @param {number} value - Next raw value.
     * @returns {void}
     */
    setSequence(sequenceName: string, value: number): void;
    /**
     * Rewinds a single global sequence to its initial value.
     * @param {string} sequenceName - Sequence name.
     * @returns {void}
     */
    rewindSequence(sequenceName: string): void;
    /**
     * Rewinds every global and factory-scoped sequence to its initial value while
     * leaving all definitions intact.
     * @returns {void}
     */
    rewindSequences(): void;
    /**
     * Clears all definitions, traits, sequences and registry defaults, restoring an
     * empty registry with the built-in strategies.
     * @returns {void}
     */
    reset(): void;
    /**
     * Runs `count` sequential strategy invocations.
     * @param {"attributesFor" | "build" | "create"} strategy - Strategy name.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of entries.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The results.
     */
    _runList(strategy: "attributesFor" | "build" | "create", factoryName: string, count: number, args: Array<ReturnType<typeof JSON.parse>>): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Compiles and runs a factory invocation under a strategy.
     * @param {object} args - Options.
     * @param {string} args.factoryName - Factory name.
     * @param {string[]} args.traits - Ordered traits.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.overrides - Overrides.
     * @param {"attributesFor" | "build" | "create"} args.strategy - Strategy name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The strategy result.
     */
    _runFactory(args: {
        factoryName: string;
        traits: string[];
        overrides: Record<string, ReturnType<typeof JSON.parse>>;
        strategy: "attributesFor" | "build" | "create";
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs one event-tracked invocation, optionally reusing declaration planning.
     * @param {object} args - Options.
     * @param {string} args.factoryName - Factory name.
     * @param {string[]} args.traits - Ordered traits.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.overrides - Overrides.
     * @param {"attributesFor" | "build" | "create"} args.strategy - Strategy name.
     * @param {import("./factory-runner.js").CompiledPlan} [args.planTemplate] - Reusable declaration plan.
     * @returns {Promise<{result: ReturnType<typeof JSON.parse>, planTemplate: import("./factory-runner.js").CompiledPlan}>} - Result and declaration plan.
     */
    _runFactoryInvocation({ factoryName, traits, overrides, strategy, planTemplate }: {
        factoryName: string;
        traits: string[];
        overrides: Record<string, ReturnType<typeof JSON.parse>>;
        strategy: "attributesFor" | "build" | "create";
        planTemplate?: import("./factory-runner.js").CompiledPlan;
    }): Promise<{
        result: ReturnType<typeof JSON.parse>;
        planTemplate: import("./factory-runner.js").CompiledPlan;
    }>;
    /**
     * Registers an immutable factory definition and its aliases.
     * @param {import("./factory-definition.js").default} definition - Compiled factory.
     * @returns {void}
     */
    _registerFactoryDefinition(definition: import("./factory-definition.js").default): void;
    /**
     * Replaces an existing factory definition (and its aliases) with a recompiled
     * one. Used by `modify`; no duplicate check because it intentionally overwrites.
     * @param {import("./factory-definition.js").default} definition - Recompiled factory.
     * @returns {void}
     */
    _replaceFactoryDefinition(definition: import("./factory-definition.js").default): void;
    /**
     * Registers a global trait.
     * @param {import("./trait-definition.js").default} trait - Compiled trait.
     * @returns {void}
     */
    _registerGlobalTrait(trait: import("./trait-definition.js").default): void;
    /**
     * Registers a sequence (and its aliases) either globally or under a factory scope.
     * @param {import("./sequence.js").default} sequence - Sequence instance.
     * @param {string | null} factoryScope - Factory name to scope under, or null for global.
     * @returns {void}
     */
    _registerSequence(sequence: import("./sequence.js").default, factoryScope: string | null): void;
    /**
     * Appends a registry-level default declaration (callbacks/construction defaults).
     * @param {import("./declarations.js").Declaration} declaration - Declaration to add.
     * @returns {void}
     */
    _addGlobalDeclaration(declaration: import("./declarations.js").Declaration): void;
    /**
     * Resolves a sequence name against a factory scope chain (child first) then the
     * global scope and advances it.
     * @param {string} sequenceName - Sequence name.
     * @param {string[]} chainNames - Inheritance chain names (child last).
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The formatted value.
     */
    _generateScoped(sequenceName: string, chainNames: string[]): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Resolves a global sequence by name.
     * @param {string} sequenceName - Sequence name.
     * @returns {import("./sequence.js").default} - The sequence.
     */
    _resolveGlobalSequence(sequenceName: string): import("./sequence.js").default;
    /**
     * Rejects setup-time mutation while evaluations are active.
     * @param {string} operation - Operation name, for the error message.
     * @returns {void}
     */
    _assertNotEvaluating(operation: string): void;
}
//# sourceMappingURL=factory-registry.d.ts.map