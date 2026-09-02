// @ts-check
import { DuplicateDefinitionError, RegistryBusyError, UndefinedSequenceError } from "./errors.js";
import AttributesForStrategy from "./strategies/attributes-for.js";
import BuildStrategy from "./strategies/build.js";
import CreateStrategy from "./strategies/create.js";
import DefinitionSession from "./definition-builder.js";
import FactoryEventEmitter from "./events.js";
import FactoryLinter from "./linter.js";
import FactoryRunner from "./factory-runner.js";
import { isPlainObject } from "is-plain-object";
/**
 * Normalizes a strategy invocation's variadic tail into ordered trait names plus
 * a single final overrides object (`strategy(name, ...traits, overrides?)`).
 * @param {Array<ReturnType<typeof JSON.parse>>} args - Arguments after the factory name (and count for lists).
 * @returns {{traits: string[], overrides: Record<string, ReturnType<typeof JSON.parse>>}} - Normalized invocation.
 */
function normalizeInvocationArgs(args) {
    /** @type {string[]} */
    const traits = [];
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let overrides = {};
    let sawOverrides = false;
    for (const arg of args) {
        if (typeof arg === "string" && !sawOverrides) {
            traits.push(arg);
        }
        else if (isPlainObject(arg) && !sawOverrides) {
            overrides = arg;
            sawOverrides = true;
        }
        else if (arg !== undefined) {
            throw new TypeError(`Invalid factory invocation argument: ${String(arg)}. Expected trait names then a single final overrides object.`);
        }
    }
    return { traits, overrides };
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
        this._factories = new Map();
        /** @type {Map<string, import("./trait-definition.js").default>} - Global traits. */
        this._globalTraits = new Map();
        /** @type {Map<string, import("./sequence.js").default>} - Global sequences and aliases. */
        this._sequences = new Map();
        /** @type {Map<string, Map<string, import("./sequence.js").default>>} - Factory-scoped sequences. */
        this._factorySequences = new Map();
        /** @type {import("./declarations.js").Declaration[]} - Registry-level default declarations. */
        this._globalDeclarations = [];
        /** @type {number} - In-flight evaluation count (mutation guard). */
        this._activeEvaluations = 0;
        /** @type {FactoryRunner} - Plan compiler. */
        this._runner = new FactoryRunner(this);
        /** @type {FactoryEventEmitter} - Debug/performance event emitter. */
        this._events = new FactoryEventEmitter();
        /** @type {{attributesFor: AttributesForStrategy, build: BuildStrategy, create: CreateStrategy}} - Installed strategies. */
        this._strategies = {
            attributesFor: new AttributesForStrategy(),
            build: new BuildStrategy(),
            create: new CreateStrategy()
        };
    }
    /**
     * Registers factories/traits/sequences/callbacks via a builder callback.
     * @param {(builder: object) => void} callback - The definition callback.
     * @returns {this} - This registry (for chaining).
     */
    define(callback) {
        this._assertNotEvaluating("define");
        new DefinitionSession(this).run(callback);
        return this;
    }
    /**
     * Reopens existing factories to append/override declarations, recompiling each
     * into a fresh immutable definition. Rejected while evaluations are active.
     * @param {(builder: object) => void} callback - The modify callback.
     * @returns {this} - This registry (for chaining).
     */
    modify(callback) {
        this._assertNotEvaluating("modify");
        new DefinitionSession(this).runModify(callback);
        return this;
    }
    /**
     * Lints factories/traits, aggregating every failure. Create-strategy cases roll
     * back their database writes.
     * @param {object} [options] - Lint options (factories, traits, strategy).
     * @returns {Promise<void>} - Resolves when all cases pass; rejects with an aggregate otherwise.
     */
    async lint(options) {
        return await new FactoryLinter(this).lint(options);
    }
    /**
     * Subscribes to factory debug events (`start`, `success`, `failure`).
     * @param {string} event - Event name.
     * @param {(payload: {invocationId: string, factory: string, strategy: string, traits: string[], durationMs?: number, error?: ReturnType<typeof JSON.parse>}) => void} handler - Event handler.
     * @returns {this} - This registry (for chaining).
     */
    on(event, handler) {
        this._events.on(event, handler);
        return this;
    }
    /**
     * Unsubscribes a previously-registered event handler.
     * @param {string} event - Event name.
     * @param {(payload: ReturnType<typeof JSON.parse>) => void} handler - Event handler to remove.
     * @returns {this} - This registry (for chaining).
     */
    off(event, handler) {
        this._events.off(event, handler);
        return this;
    }
    /**
     * Resolves attributes without constructing a model or building associations.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - The resolved attributes.
     */
    async attributesFor(factoryName, ...args) {
        const { traits, overrides } = normalizeInvocationArgs(args);
        return await this._runFactory({ factoryName, traits, overrides, strategy: "attributesFor" });
    }
    /**
     * Builds an unsaved record graph.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The built record.
     */
    async build(factoryName, ...args) {
        const { traits, overrides } = normalizeInvocationArgs(args);
        return await this._runFactory({ factoryName, traits, overrides, strategy: "build" });
    }
    /**
     * Builds and persists a record graph.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The persisted record.
     */
    async create(factoryName, ...args) {
        const { traits, overrides } = normalizeInvocationArgs(args);
        return await this._runFactory({ factoryName, traits, overrides, strategy: "create" });
    }
    /**
     * Resolves attributes for a list of records sequentially.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of entries.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - The resolved attribute objects.
     */
    async attributesForList(factoryName, count, ...args) {
        return await this._runList("attributesFor", factoryName, count, args);
    }
    /**
     * Builds a list of unsaved records sequentially.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of records.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The built records.
     */
    async buildList(factoryName, count, ...args) {
        return await this._runList("build", factoryName, count, args);
    }
    /**
     * Creates a list of persisted records sequentially.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of records.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The persisted records.
     */
    async createList(factoryName, count, ...args) {
        return await this._runList("create", factoryName, count, args);
    }
    /**
     * Resolves attributes for exactly two records.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - The two resolved attribute objects.
     */
    async attributesForPair(factoryName, ...args) {
        return await this._runList("attributesFor", factoryName, 2, args);
    }
    /**
     * Builds exactly two unsaved records.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The two built records.
     */
    async buildPair(factoryName, ...args) {
        return await this._runList("build", factoryName, 2, args);
    }
    /**
     * Creates exactly two persisted records.
     * @param {string} factoryName - Factory name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The two persisted records.
     */
    async createPair(factoryName, ...args) {
        return await this._runList("create", factoryName, 2, args);
    }
    /**
     * Advances a sequence and returns its formatted value.
     * @param {string} sequenceName - Sequence name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The formatted value.
     */
    async generate(sequenceName) {
        return await this._generateScoped(sequenceName, []);
    }
    /**
     * Advances a sequence `count` times and returns the formatted values.
     * @param {string} sequenceName - Sequence name.
     * @param {number} count - Number of values.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The formatted values.
     */
    async generateList(sequenceName, count) {
        /** @type {Array<ReturnType<typeof JSON.parse>>} */
        const values = [];
        for (let index = 0; index < count; index++) {
            values.push(await this._generateScoped(sequenceName, []));
        }
        return values;
    }
    /**
     * Returns the next raw value a global sequence would allocate without consuming it.
     * @param {string} sequenceName - Sequence name.
     * @returns {number} - The upcoming raw value.
     */
    peekSequence(sequenceName) {
        return this._resolveGlobalSequence(sequenceName).peek();
    }
    /**
     * Sets the next value a global sequence will allocate.
     * @param {string} sequenceName - Sequence name.
     * @param {number} value - Next raw value.
     * @returns {void}
     */
    setSequence(sequenceName, value) {
        this._assertNotEvaluating("setSequence");
        this._resolveGlobalSequence(sequenceName).set(value);
    }
    /**
     * Rewinds a single global sequence to its initial value.
     * @param {string} sequenceName - Sequence name.
     * @returns {void}
     */
    rewindSequence(sequenceName) {
        this._assertNotEvaluating("rewindSequence");
        this._resolveGlobalSequence(sequenceName).rewind();
    }
    /**
     * Rewinds every global and factory-scoped sequence to its initial value while
     * leaving all definitions intact.
     * @returns {void}
     */
    rewindSequences() {
        this._assertNotEvaluating("rewindSequences");
        for (const sequence of new Set(this._sequences.values()))
            sequence.rewind();
        for (const scope of this._factorySequences.values()) {
            for (const sequence of new Set(scope.values()))
                sequence.rewind();
        }
    }
    /**
     * Clears all definitions, traits, sequences and registry defaults, restoring an
     * empty registry with the built-in strategies.
     * @returns {void}
     */
    reset() {
        this._assertNotEvaluating("reset");
        this._factories.clear();
        this._globalTraits.clear();
        this._sequences.clear();
        this._factorySequences.clear();
        this._globalDeclarations = [];
        this._events = new FactoryEventEmitter();
    }
    /**
     * Runs `count` sequential strategy invocations.
     * @param {"attributesFor" | "build" | "create"} strategy - Strategy name.
     * @param {string} factoryName - Factory name.
     * @param {number} count - Number of entries.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Trait names then an optional overrides object.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - The results.
     */
    async _runList(strategy, factoryName, count, args) {
        const { traits, overrides } = normalizeInvocationArgs(args);
        /** @type {Array<ReturnType<typeof JSON.parse>>} */
        const results = [];
        /** @type {import("./factory-runner.js").CompiledPlan | undefined} */
        let planTemplate;
        this._activeEvaluations += 1;
        try {
            for (let index = 0; index < count; index++) {
                const invocation = await this._runFactoryInvocation({ factoryName, traits, overrides, strategy, planTemplate });
                planTemplate = invocation.planTemplate;
                results.push(invocation.result);
            }
        }
        finally {
            this._activeEvaluations -= 1;
        }
        return results;
    }
    /**
     * Compiles and runs a factory invocation under a strategy.
     * @param {object} args - Options.
     * @param {string} args.factoryName - Factory name.
     * @param {string[]} args.traits - Ordered traits.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.overrides - Overrides.
     * @param {"attributesFor" | "build" | "create"} args.strategy - Strategy name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The strategy result.
     */
    async _runFactory(args) {
        return (await this._runFactoryInvocation(args)).result;
    }
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
    async _runFactoryInvocation({ factoryName, traits, overrides, strategy, planTemplate }) {
        this._activeEvaluations += 1;
        const invocationId = this._events.nextInvocationId();
        const startedAt = Date.now();
        try {
            this._events.emit("start", { invocationId, factory: factoryName, strategy, traits });
            const compiledPlanTemplate = planTemplate || this._runner.compileTemplate(factoryName, traits);
            const compiledPlan = this._runner.applyOverrides(compiledPlanTemplate, overrides);
            const result = await this._strategies[strategy].run({ registry: this, plan: compiledPlan });
            this._events.emit("success", { invocationId, factory: factoryName, strategy, traits, durationMs: Date.now() - startedAt });
            return { result, planTemplate: compiledPlanTemplate };
        }
        catch (error) {
            this._events.emit("failure", { invocationId, factory: factoryName, strategy, traits, durationMs: Date.now() - startedAt, error });
            throw error;
        }
        finally {
            this._activeEvaluations -= 1;
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
                throw new DuplicateDefinitionError(`Factory "${name}" is already registered`);
            }
        }
        for (const name of [definition.name, ...definition.aliases]) {
            this._factories.set(name, definition);
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
            this._factories.set(name, definition);
        }
    }
    /**
     * Registers a global trait.
     * @param {import("./trait-definition.js").default} trait - Compiled trait.
     * @returns {void}
     */
    _registerGlobalTrait(trait) {
        if (this._globalTraits.has(trait.name)) {
            throw new DuplicateDefinitionError(`Trait "${trait.name}" is already registered`);
        }
        this._globalTraits.set(trait.name, trait);
    }
    /**
     * Registers a sequence (and its aliases) either globally or under a factory scope.
     * @param {import("./sequence.js").default} sequence - Sequence instance.
     * @param {string | null} factoryScope - Factory name to scope under, or null for global.
     * @returns {void}
     */
    _registerSequence(sequence, factoryScope) {
        /** @type {Map<string, import("./sequence.js").default>} */
        let target;
        if (factoryScope) {
            if (!this._factorySequences.has(factoryScope))
                this._factorySequences.set(factoryScope, new Map());
            target = /** @type {Map<string, import("./sequence.js").default>} */ (this._factorySequences.get(factoryScope));
        }
        else {
            target = this._sequences;
        }
        for (const name of [sequence.name, ...sequence.aliases]) {
            if (target.has(name)) {
                throw new DuplicateDefinitionError(`Sequence "${name}" is already registered${factoryScope ? ` for factory "${factoryScope}"` : ""}`);
            }
        }
        for (const name of [sequence.name, ...sequence.aliases]) {
            target.set(name, sequence);
        }
    }
    /**
     * Appends a registry-level default declaration (callbacks/construction defaults).
     * @param {import("./declarations.js").Declaration} declaration - Declaration to add.
     * @returns {void}
     */
    _addGlobalDeclaration(declaration) {
        this._globalDeclarations.push(declaration);
    }
    /**
     * Resolves a sequence name against a factory scope chain (child first) then the
     * global scope and advances it.
     * @param {string} sequenceName - Sequence name.
     * @param {string[]} chainNames - Inheritance chain names (child last).
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The formatted value.
     */
    async _generateScoped(sequenceName, chainNames) {
        for (let index = chainNames.length - 1; index >= 0; index--) {
            const scope = this._factorySequences.get(chainNames[index]);
            if (scope && scope.has(sequenceName)) {
                return await /** @type {import("./sequence.js").default} */ (scope.get(sequenceName)).next();
            }
        }
        return await this._resolveGlobalSequence(sequenceName).next();
    }
    /**
     * Resolves a global sequence by name.
     * @param {string} sequenceName - Sequence name.
     * @returns {import("./sequence.js").default} - The sequence.
     */
    _resolveGlobalSequence(sequenceName) {
        const sequence = this._sequences.get(sequenceName);
        if (!sequence) {
            throw new UndefinedSequenceError(`No sequence registered called "${sequenceName}"`);
        }
        return sequence;
    }
    /**
     * Rejects setup-time mutation while evaluations are active.
     * @param {string} operation - Operation name, for the error message.
     * @returns {void}
     */
    _assertNotEvaluating(operation) {
        if (this._activeEvaluations > 0) {
            throw new RegistryBusyError(`Cannot ${operation} while factory evaluations are active. Registry mutation is setup-time only.`);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFjdG9yeS1yZWdpc3RyeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL2ZhY3RvcnkvZmFjdG9yeS1yZWdpc3RyeS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLHdCQUF3QixFQUFFLGlCQUFpQixFQUFFLHNCQUFzQixFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQy9GLE9BQU8scUJBQXFCLE1BQU0sZ0NBQWdDLENBQUE7QUFDbEUsT0FBTyxhQUFhLE1BQU0sdUJBQXVCLENBQUE7QUFDakQsT0FBTyxjQUFjLE1BQU0sd0JBQXdCLENBQUE7QUFDbkQsT0FBTyxpQkFBaUIsTUFBTSx5QkFBeUIsQ0FBQTtBQUN2RCxPQUFPLG1CQUFtQixNQUFNLGFBQWEsQ0FBQTtBQUM3QyxPQUFPLGFBQWEsTUFBTSxhQUFhLENBQUE7QUFDdkMsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLGlCQUFpQixDQUFBO0FBRTdDOzs7OztHQUtHO0FBQ0gsU0FBUyx1QkFBdUIsQ0FBQyxJQUFJO0lBQ25DLHVCQUF1QjtJQUN2QixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7SUFDakIsNERBQTREO0lBQzVELElBQUksU0FBUyxHQUFHLEVBQUUsQ0FBQTtJQUNsQixJQUFJLFlBQVksR0FBRyxLQUFLLENBQUE7SUFFeEIsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUN2QixJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQzdDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDbEIsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDL0MsU0FBUyxHQUFHLEdBQUcsQ0FBQTtZQUNmLFlBQVks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LElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtJQUMvRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHNCQUFzQixDQUFDLFlBQVk7UUFDakMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUE7UUFFbEQsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2QsTUFBTSxJQUFJLHNCQUFzQixDQUFDLGtDQUFrQyxZQUFZLEdBQUcsQ0FBQyxDQUFBO1FBQ3JGLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG9CQUFvQixDQUFDLFNBQVM7UUFDNUIsSUFBSSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDaEMsTUFBTSxJQUFJLGlCQUFpQixDQUFDLFVBQVUsU0FBUyw4RUFBOEUsQ0FBQyxDQUFBO1FBQ2hJLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtEdXBsaWNhdGVEZWZpbml0aW9uRXJyb3IsIFJlZ2lzdHJ5QnVzeUVycm9yLCBVbmRlZmluZWRTZXF1ZW5jZUVycm9yfSBmcm9tIFwiLi9lcnJvcnMuanNcIlxuaW1wb3J0IEF0dHJpYnV0ZXNGb3JTdHJhdGVneSBmcm9tIFwiLi9zdHJhdGVnaWVzL2F0dHJpYnV0ZXMtZm9yLmpzXCJcbmltcG9ydCBCdWlsZFN0cmF0ZWd5IGZyb20gXCIuL3N0cmF0ZWdpZXMvYnVpbGQuanNcIlxuaW1wb3J0IENyZWF0ZVN0cmF0ZWd5IGZyb20gXCIuL3N0cmF0ZWdpZXMvY3JlYXRlLmpzXCJcbmltcG9ydCBEZWZpbml0aW9uU2Vzc2lvbiBmcm9tIFwiLi9kZWZpbml0aW9uLWJ1aWxkZXIuanNcIlxuaW1wb3J0IEZhY3RvcnlFdmVudEVtaXR0ZXIgZnJvbSBcIi4vZXZlbnRzLmpzXCJcbmltcG9ydCBGYWN0b3J5TGludGVyIGZyb20gXCIuL2xpbnRlci5qc1wiXG5pbXBvcnQgRmFjdG9yeVJ1bm5lciBmcm9tIFwiLi9mYWN0b3J5LXJ1bm5lci5qc1wiXG5pbXBvcnQge2lzUGxhaW5PYmplY3R9IGZyb20gXCJpcy1wbGFpbi1vYmplY3RcIlxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBzdHJhdGVneSBpbnZvY2F0aW9uJ3MgdmFyaWFkaWMgdGFpbCBpbnRvIG9yZGVyZWQgdHJhaXQgbmFtZXMgcGx1c1xuICogYSBzaW5nbGUgZmluYWwgb3ZlcnJpZGVzIG9iamVjdCAoYHN0cmF0ZWd5KG5hbWUsIC4uLnRyYWl0cywgb3ZlcnJpZGVzPylgKS5cbiAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gQXJndW1lbnRzIGFmdGVyIHRoZSBmYWN0b3J5IG5hbWUgKGFuZCBjb3VudCBmb3IgbGlzdHMpLlxuICogQHJldHVybnMge3t0cmFpdHM6IHN0cmluZ1tdLCBvdmVycmlkZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IC0gTm9ybWFsaXplZCBpbnZvY2F0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVJbnZvY2F0aW9uQXJncyhhcmdzKSB7XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IHRyYWl0cyA9IFtdXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgb3ZlcnJpZGVzID0ge31cbiAgbGV0IHNhd092ZXJyaWRlcyA9IGZhbHNlXG5cbiAgZm9yIChjb25zdCBhcmcgb2YgYXJncykge1xuICAgIGlmICh0eXBlb2YgYXJnID09PSBcInN0cmluZ1wiICYmICFzYXdPdmVycmlkZXMpIHtcbiAgICAgIHRyYWl0cy5wdXNoKGFyZylcbiAgICB9IGVsc2UgaWYgKGlzUGxhaW5PYmplY3QoYXJnKSAmJiAhc2F3T3ZlcnJpZGVzKSB7XG4gICAgICBvdmVycmlkZXMgPSBhcmdcbiAgICAgIHNhd092ZXJyaWRlcyA9IHRydWVcbiAgICB9IGVsc2UgaWYgKGFyZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGZhY3RvcnkgaW52b2NhdGlvbiBhcmd1bWVudDogJHtTdHJpbmcoYXJnKX0uIEV4cGVjdGVkIHRyYWl0IG5hbWVzIHRoZW4gYSBzaW5nbGUgZmluYWwgb3ZlcnJpZGVzIG9iamVjdC5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7dHJhaXRzLCBvdmVycmlkZXN9XG59XG5cbi8qKlxuICogT3ducyBhbGwgZmFjdG9yaWVzLCB0cmFpdHMsIHNlcXVlbmNlcywgY2FsbGJhY2tzIGFuZCBjb25zdHJ1Y3Rpb24gZGVmYXVsdHMgZm9yXG4gKiBvbmUgaXNvbGF0ZWQgc2NvcGUsIGFuZCBleHBvc2VzIHRoZSBzdHJhdGVneSBlbnRyeSBwb2ludHMuIFJlZ2lzdHJ5IG11dGF0aW9uIGlzXG4gKiBzZXR1cC10aW1lIG9ubHkgYW5kIGlzIHJlamVjdGVkIHdoaWxlIGV2YWx1YXRpb25zIGFyZSBhY3RpdmUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZhY3RvcnlSZWdpc3RyeSB7XG4gIC8qKiBCdWlsZHMgYW4gZW1wdHkgcmVnaXN0cnkgd2l0aCB0aGUgYnVpbHQtaW4gc3RyYXRlZ2llcyBpbnN0YWxsZWQuICovXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdD59IC0gRmFjdG9yaWVzIGFuZCBhbGlhc2VzLiAqL1xuICAgIHRoaXMuX2ZhY3RvcmllcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3RyYWl0LWRlZmluaXRpb24uanNcIikuZGVmYXVsdD59IC0gR2xvYmFsIHRyYWl0cy4gKi9cbiAgICB0aGlzLl9nbG9iYWxUcmFpdHMgPSBuZXcgTWFwKClcblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi9zZXF1ZW5jZS5qc1wiKS5kZWZhdWx0Pn0gLSBHbG9iYWwgc2VxdWVuY2VzIGFuZCBhbGlhc2VzLiAqL1xuICAgIHRoaXMuX3NlcXVlbmNlcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3NlcXVlbmNlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBGYWN0b3J5LXNjb3BlZCBzZXF1ZW5jZXMuICovXG4gICAgdGhpcy5fZmFjdG9yeVNlcXVlbmNlcyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5EZWNsYXJhdGlvbltdfSAtIFJlZ2lzdHJ5LWxldmVsIGRlZmF1bHQgZGVjbGFyYXRpb25zLiAqL1xuICAgIHRoaXMuX2dsb2JhbERlY2xhcmF0aW9ucyA9IFtdXG5cbiAgICAvKiogQHR5cGUge251bWJlcn0gLSBJbi1mbGlnaHQgZXZhbHVhdGlvbiBjb3VudCAobXV0YXRpb24gZ3VhcmQpLiAqL1xuICAgIHRoaXMuX2FjdGl2ZUV2YWx1YXRpb25zID0gMFxuXG4gICAgLyoqIEB0eXBlIHtGYWN0b3J5UnVubmVyfSAtIFBsYW4gY29tcGlsZXIuICovXG4gICAgdGhpcy5fcnVubmVyID0gbmV3IEZhY3RvcnlSdW5uZXIodGhpcylcblxuICAgIC8qKiBAdHlwZSB7RmFjdG9yeUV2ZW50RW1pdHRlcn0gLSBEZWJ1Zy9wZXJmb3JtYW5jZSBldmVudCBlbWl0dGVyLiAqL1xuICAgIHRoaXMuX2V2ZW50cyA9IG5ldyBGYWN0b3J5RXZlbnRFbWl0dGVyKClcblxuICAgIC8qKiBAdHlwZSB7e2F0dHJpYnV0ZXNGb3I6IEF0dHJpYnV0ZXNGb3JTdHJhdGVneSwgYnVpbGQ6IEJ1aWxkU3RyYXRlZ3ksIGNyZWF0ZTogQ3JlYXRlU3RyYXRlZ3l9fSAtIEluc3RhbGxlZCBzdHJhdGVnaWVzLiAqL1xuICAgIHRoaXMuX3N0cmF0ZWdpZXMgPSB7XG4gICAgICBhdHRyaWJ1dGVzRm9yOiBuZXcgQXR0cmlidXRlc0ZvclN0cmF0ZWd5KCksXG4gICAgICBidWlsZDogbmV3IEJ1aWxkU3RyYXRlZ3koKSxcbiAgICAgIGNyZWF0ZTogbmV3IENyZWF0ZVN0cmF0ZWd5KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGZhY3Rvcmllcy90cmFpdHMvc2VxdWVuY2VzL2NhbGxiYWNrcyB2aWEgYSBidWlsZGVyIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geyhidWlsZGVyOiBvYmplY3QpID0+IHZvaWR9IGNhbGxiYWNrIC0gVGhlIGRlZmluaXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcmVnaXN0cnkgKGZvciBjaGFpbmluZykuXG4gICAqL1xuICBkZWZpbmUoY2FsbGJhY2spIHtcbiAgICB0aGlzLl9hc3NlcnROb3RFdmFsdWF0aW5nKFwiZGVmaW5lXCIpXG4gICAgbmV3IERlZmluaXRpb25TZXNzaW9uKHRoaXMpLnJ1bihjYWxsYmFjaylcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmVvcGVucyBleGlzdGluZyBmYWN0b3JpZXMgdG8gYXBwZW5kL292ZXJyaWRlIGRlY2xhcmF0aW9ucywgcmVjb21waWxpbmcgZWFjaFxuICAgKiBpbnRvIGEgZnJlc2ggaW1tdXRhYmxlIGRlZmluaXRpb24uIFJlamVjdGVkIHdoaWxlIGV2YWx1YXRpb25zIGFyZSBhY3RpdmUuXG4gICAqIEBwYXJhbSB7KGJ1aWxkZXI6IG9iamVjdCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBUaGUgbW9kaWZ5IGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHJlZ2lzdHJ5IChmb3IgY2hhaW5pbmcpLlxuICAgKi9cbiAgbW9kaWZ5KGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90RXZhbHVhdGluZyhcIm1vZGlmeVwiKVxuICAgIG5ldyBEZWZpbml0aW9uU2Vzc2lvbih0aGlzKS5ydW5Nb2RpZnkoY2FsbGJhY2spXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIExpbnRzIGZhY3Rvcmllcy90cmFpdHMsIGFnZ3JlZ2F0aW5nIGV2ZXJ5IGZhaWx1cmUuIENyZWF0ZS1zdHJhdGVneSBjYXNlcyByb2xsXG4gICAqIGJhY2sgdGhlaXIgZGF0YWJhc2Ugd3JpdGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gTGludCBvcHRpb25zIChmYWN0b3JpZXMsIHRyYWl0cywgc3RyYXRlZ3kpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBjYXNlcyBwYXNzOyByZWplY3RzIHdpdGggYW4gYWdncmVnYXRlIG90aGVyd2lzZS5cbiAgICovXG4gIGFzeW5jIGxpbnQob3B0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCBuZXcgRmFjdG9yeUxpbnRlcih0aGlzKS5saW50KG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0byBmYWN0b3J5IGRlYnVnIGV2ZW50cyAoYHN0YXJ0YCwgYHN1Y2Nlc3NgLCBgZmFpbHVyZWApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aW52b2NhdGlvbklkOiBzdHJpbmcsIGZhY3Rvcnk6IHN0cmluZywgc3RyYXRlZ3k6IHN0cmluZywgdHJhaXRzOiBzdHJpbmdbXSwgZHVyYXRpb25Ncz86IG51bWJlciwgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0pID0+IHZvaWR9IGhhbmRsZXIgLSBFdmVudCBoYW5kbGVyLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHJlZ2lzdHJ5IChmb3IgY2hhaW5pbmcpLlxuICAgKi9cbiAgb24oZXZlbnQsIGhhbmRsZXIpIHtcbiAgICB0aGlzLl9ldmVudHMub24oZXZlbnQsIGhhbmRsZXIpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFVuc3Vic2NyaWJlcyBhIHByZXZpb3VzbHktcmVnaXN0ZXJlZCBldmVudCBoYW5kbGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZH0gaGFuZGxlciAtIEV2ZW50IGhhbmRsZXIgdG8gcmVtb3ZlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHJlZ2lzdHJ5IChmb3IgY2hhaW5pbmcpLlxuICAgKi9cbiAgb2ZmKGV2ZW50LCBoYW5kbGVyKSB7XG4gICAgdGhpcy5fZXZlbnRzLm9mZihldmVudCwgaGFuZGxlcilcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYXR0cmlidXRlcyB3aXRob3V0IGNvbnN0cnVjdGluZyBhIG1vZGVsIG9yIGJ1aWxkaW5nIGFzc29jaWF0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gRmFjdG9yeSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFRyYWl0IG5hbWVzIHRoZW4gYW4gb3B0aW9uYWwgb3ZlcnJpZGVzIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgcmVzb2x2ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIGFzeW5jIGF0dHJpYnV0ZXNGb3IoZmFjdG9yeU5hbWUsIC4uLmFyZ3MpIHtcbiAgICBjb25zdCB7dHJhaXRzLCBvdmVycmlkZXN9ID0gbm9ybWFsaXplSW52b2NhdGlvbkFyZ3MoYXJncylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5GYWN0b3J5KHtmYWN0b3J5TmFtZSwgdHJhaXRzLCBvdmVycmlkZXMsIHN0cmF0ZWd5OiBcImF0dHJpYnV0ZXNGb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGFuIHVuc2F2ZWQgcmVjb3JkIGdyYXBoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmFjdG9yeU5hbWUgLSBGYWN0b3J5IG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gVHJhaXQgbmFtZXMgdGhlbiBhbiBvcHRpb25hbCBvdmVycmlkZXMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGJ1aWx0IHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGJ1aWxkKGZhY3RvcnlOYW1lLCAuLi5hcmdzKSB7XG4gICAgY29uc3Qge3RyYWl0cywgb3ZlcnJpZGVzfSA9IG5vcm1hbGl6ZUludm9jYXRpb25BcmdzKGFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuRmFjdG9yeSh7ZmFjdG9yeU5hbWUsIHRyYWl0cywgb3ZlcnJpZGVzLCBzdHJhdGVneTogXCJidWlsZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYW5kIHBlcnNpc3RzIGEgcmVjb3JkIGdyYXBoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmFjdG9yeU5hbWUgLSBGYWN0b3J5IG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gVHJhaXQgbmFtZXMgdGhlbiBhbiBvcHRpb25hbCBvdmVycmlkZXMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIHBlcnNpc3RlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoZmFjdG9yeU5hbWUsIC4uLmFyZ3MpIHtcbiAgICBjb25zdCB7dHJhaXRzLCBvdmVycmlkZXN9ID0gbm9ybWFsaXplSW52b2NhdGlvbkFyZ3MoYXJncylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5GYWN0b3J5KHtmYWN0b3J5TmFtZSwgdHJhaXRzLCBvdmVycmlkZXMsIHN0cmF0ZWd5OiBcImNyZWF0ZVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhdHRyaWJ1dGVzIGZvciBhIGxpc3Qgb2YgcmVjb3JkcyBzZXF1ZW50aWFsbHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmYWN0b3J5TmFtZSAtIEZhY3RvcnkgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvdW50IC0gTnVtYmVyIG9mIGVudHJpZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gVHJhaXQgbmFtZXMgdGhlbiBhbiBvcHRpb25hbCBvdmVycmlkZXMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gLSBUaGUgcmVzb2x2ZWQgYXR0cmlidXRlIG9iamVjdHMuXG4gICAqL1xuICBhc3luYyBhdHRyaWJ1dGVzRm9yTGlzdChmYWN0b3J5TmFtZSwgY291bnQsIC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlzdChcImF0dHJpYnV0ZXNGb3JcIiwgZmFjdG9yeU5hbWUsIGNvdW50LCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGxpc3Qgb2YgdW5zYXZlZCByZWNvcmRzIHNlcXVlbnRpYWxseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gRmFjdG9yeSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gY291bnQgLSBOdW1iZXIgb2YgcmVjb3Jkcy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBUcmFpdCBuYW1lcyB0aGVuIGFuIG9wdGlvbmFsIG92ZXJyaWRlcyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIGJ1aWx0IHJlY29yZHMuXG4gICAqL1xuICBhc3luYyBidWlsZExpc3QoZmFjdG9yeU5hbWUsIGNvdW50LCAuLi5hcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkxpc3QoXCJidWlsZFwiLCBmYWN0b3J5TmFtZSwgY291bnQsIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIGxpc3Qgb2YgcGVyc2lzdGVkIHJlY29yZHMgc2VxdWVudGlhbGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmFjdG9yeU5hbWUgLSBGYWN0b3J5IG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjb3VudCAtIE51bWJlciBvZiByZWNvcmRzLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFRyYWl0IG5hbWVzIHRoZW4gYW4gb3B0aW9uYWwgb3ZlcnJpZGVzIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgcGVyc2lzdGVkIHJlY29yZHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVMaXN0KGZhY3RvcnlOYW1lLCBjb3VudCwgLi4uYXJncykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5MaXN0KFwiY3JlYXRlXCIsIGZhY3RvcnlOYW1lLCBjb3VudCwgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhdHRyaWJ1dGVzIGZvciBleGFjdGx5IHR3byByZWNvcmRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmFjdG9yeU5hbWUgLSBGYWN0b3J5IG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gVHJhaXQgbmFtZXMgdGhlbiBhbiBvcHRpb25hbCBvdmVycmlkZXMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gLSBUaGUgdHdvIHJlc29sdmVkIGF0dHJpYnV0ZSBvYmplY3RzLlxuICAgKi9cbiAgYXN5bmMgYXR0cmlidXRlc0ZvclBhaXIoZmFjdG9yeU5hbWUsIC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlzdChcImF0dHJpYnV0ZXNGb3JcIiwgZmFjdG9yeU5hbWUsIDIsIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGV4YWN0bHkgdHdvIHVuc2F2ZWQgcmVjb3Jkcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gRmFjdG9yeSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFRyYWl0IG5hbWVzIHRoZW4gYW4gb3B0aW9uYWwgb3ZlcnJpZGVzIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgdHdvIGJ1aWx0IHJlY29yZHMuXG4gICAqL1xuICBhc3luYyBidWlsZFBhaXIoZmFjdG9yeU5hbWUsIC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlzdChcImJ1aWxkXCIsIGZhY3RvcnlOYW1lLCAyLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgZXhhY3RseSB0d28gcGVyc2lzdGVkIHJlY29yZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmYWN0b3J5TmFtZSAtIEZhY3RvcnkgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBUcmFpdCBuYW1lcyB0aGVuIGFuIG9wdGlvbmFsIG92ZXJyaWRlcyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIHR3byBwZXJzaXN0ZWQgcmVjb3Jkcy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVBhaXIoZmFjdG9yeU5hbWUsIC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuTGlzdChcImNyZWF0ZVwiLCBmYWN0b3J5TmFtZSwgMiwgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZhbmNlcyBhIHNlcXVlbmNlIGFuZCByZXR1cm5zIGl0cyBmb3JtYXR0ZWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXF1ZW5jZU5hbWUgLSBTZXF1ZW5jZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGZvcm1hdHRlZCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGdlbmVyYXRlKHNlcXVlbmNlTmFtZSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9nZW5lcmF0ZVNjb3BlZChzZXF1ZW5jZU5hbWUsIFtdKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkdmFuY2VzIGEgc2VxdWVuY2UgYGNvdW50YCB0aW1lcyBhbmQgcmV0dXJucyB0aGUgZm9ybWF0dGVkIHZhbHVlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlcXVlbmNlTmFtZSAtIFNlcXVlbmNlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjb3VudCAtIE51bWJlciBvZiB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIGZvcm1hdHRlZCB2YWx1ZXMuXG4gICAqL1xuICBhc3luYyBnZW5lcmF0ZUxpc3Qoc2VxdWVuY2VOYW1lLCBjb3VudCkge1xuICAgIC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY291bnQ7IGluZGV4KyspIHtcbiAgICAgIHZhbHVlcy5wdXNoKGF3YWl0IHRoaXMuX2dlbmVyYXRlU2NvcGVkKHNlcXVlbmNlTmFtZSwgW10pKVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBuZXh0IHJhdyB2YWx1ZSBhIGdsb2JhbCBzZXF1ZW5jZSB3b3VsZCBhbGxvY2F0ZSB3aXRob3V0IGNvbnN1bWluZyBpdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlcXVlbmNlTmFtZSAtIFNlcXVlbmNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHVwY29taW5nIHJhdyB2YWx1ZS5cbiAgICovXG4gIHBlZWtTZXF1ZW5jZShzZXF1ZW5jZU5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzb2x2ZUdsb2JhbFNlcXVlbmNlKHNlcXVlbmNlTmFtZSkucGVlaygpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgbmV4dCB2YWx1ZSBhIGdsb2JhbCBzZXF1ZW5jZSB3aWxsIGFsbG9jYXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2VxdWVuY2VOYW1lIC0gU2VxdWVuY2UgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTmV4dCByYXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0U2VxdWVuY2Uoc2VxdWVuY2VOYW1lLCB2YWx1ZSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdEV2YWx1YXRpbmcoXCJzZXRTZXF1ZW5jZVwiKVxuICAgIHRoaXMuX3Jlc29sdmVHbG9iYWxTZXF1ZW5jZShzZXF1ZW5jZU5hbWUpLnNldCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXdpbmRzIGEgc2luZ2xlIGdsb2JhbCBzZXF1ZW5jZSB0byBpdHMgaW5pdGlhbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlcXVlbmNlTmFtZSAtIFNlcXVlbmNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmV3aW5kU2VxdWVuY2Uoc2VxdWVuY2VOYW1lKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90RXZhbHVhdGluZyhcInJld2luZFNlcXVlbmNlXCIpXG4gICAgdGhpcy5fcmVzb2x2ZUdsb2JhbFNlcXVlbmNlKHNlcXVlbmNlTmFtZSkucmV3aW5kKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXdpbmRzIGV2ZXJ5IGdsb2JhbCBhbmQgZmFjdG9yeS1zY29wZWQgc2VxdWVuY2UgdG8gaXRzIGluaXRpYWwgdmFsdWUgd2hpbGVcbiAgICogbGVhdmluZyBhbGwgZGVmaW5pdGlvbnMgaW50YWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJld2luZFNlcXVlbmNlcygpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RFdmFsdWF0aW5nKFwicmV3aW5kU2VxdWVuY2VzXCIpXG5cbiAgICBmb3IgKGNvbnN0IHNlcXVlbmNlIG9mIG5ldyBTZXQodGhpcy5fc2VxdWVuY2VzLnZhbHVlcygpKSkgc2VxdWVuY2UucmV3aW5kKClcblxuICAgIGZvciAoY29uc3Qgc2NvcGUgb2YgdGhpcy5fZmFjdG9yeVNlcXVlbmNlcy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBzZXF1ZW5jZSBvZiBuZXcgU2V0KHNjb3BlLnZhbHVlcygpKSkgc2VxdWVuY2UucmV3aW5kKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGFsbCBkZWZpbml0aW9ucywgdHJhaXRzLCBzZXF1ZW5jZXMgYW5kIHJlZ2lzdHJ5IGRlZmF1bHRzLCByZXN0b3JpbmcgYW5cbiAgICogZW1wdHkgcmVnaXN0cnkgd2l0aCB0aGUgYnVpbHQtaW4gc3RyYXRlZ2llcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXNldCgpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RFdmFsdWF0aW5nKFwicmVzZXRcIilcbiAgICB0aGlzLl9mYWN0b3JpZXMuY2xlYXIoKVxuICAgIHRoaXMuX2dsb2JhbFRyYWl0cy5jbGVhcigpXG4gICAgdGhpcy5fc2VxdWVuY2VzLmNsZWFyKClcbiAgICB0aGlzLl9mYWN0b3J5U2VxdWVuY2VzLmNsZWFyKClcbiAgICB0aGlzLl9nbG9iYWxEZWNsYXJhdGlvbnMgPSBbXVxuICAgIHRoaXMuX2V2ZW50cyA9IG5ldyBGYWN0b3J5RXZlbnRFbWl0dGVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjb3VudGAgc2VxdWVudGlhbCBzdHJhdGVneSBpbnZvY2F0aW9ucy5cbiAgICogQHBhcmFtIHtcImF0dHJpYnV0ZXNGb3JcIiB8IFwiYnVpbGRcIiB8IFwiY3JlYXRlXCJ9IHN0cmF0ZWd5IC0gU3RyYXRlZ3kgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gRmFjdG9yeSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gY291bnQgLSBOdW1iZXIgb2YgZW50cmllcy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBUcmFpdCBuYW1lcyB0aGVuIGFuIG9wdGlvbmFsIG92ZXJyaWRlcyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIHJlc3VsdHMuXG4gICAqL1xuICBhc3luYyBfcnVuTGlzdChzdHJhdGVneSwgZmFjdG9yeU5hbWUsIGNvdW50LCBhcmdzKSB7XG4gICAgY29uc3Qge3RyYWl0cywgb3ZlcnJpZGVzfSA9IG5vcm1hbGl6ZUludm9jYXRpb25BcmdzKGFyZ3MpXG4gICAgLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVzdWx0cyA9IFtdXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2ZhY3RvcnktcnVubmVyLmpzXCIpLkNvbXBpbGVkUGxhbiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcGxhblRlbXBsYXRlXG5cbiAgICB0aGlzLl9hY3RpdmVFdmFsdWF0aW9ucyArPSAxXG5cbiAgICB0cnkge1xuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvdW50OyBpbmRleCsrKSB7XG4gICAgICAgIGNvbnN0IGludm9jYXRpb24gPSBhd2FpdCB0aGlzLl9ydW5GYWN0b3J5SW52b2NhdGlvbih7ZmFjdG9yeU5hbWUsIHRyYWl0cywgb3ZlcnJpZGVzLCBzdHJhdGVneSwgcGxhblRlbXBsYXRlfSlcblxuICAgICAgICBwbGFuVGVtcGxhdGUgPSBpbnZvY2F0aW9uLnBsYW5UZW1wbGF0ZVxuICAgICAgICByZXN1bHRzLnB1c2goaW52b2NhdGlvbi5yZXN1bHQpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2FjdGl2ZUV2YWx1YXRpb25zIC09IDFcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0c1xuICB9XG5cbiAgLyoqXG4gICAqIENvbXBpbGVzIGFuZCBydW5zIGEgZmFjdG9yeSBpbnZvY2F0aW9uIHVuZGVyIGEgc3RyYXRlZ3kuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmFjdG9yeU5hbWUgLSBGYWN0b3J5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MudHJhaXRzIC0gT3JkZXJlZCB0cmFpdHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLm92ZXJyaWRlcyAtIE92ZXJyaWRlcy5cbiAgICogQHBhcmFtIHtcImF0dHJpYnV0ZXNGb3JcIiB8IFwiYnVpbGRcIiB8IFwiY3JlYXRlXCJ9IGFyZ3Muc3RyYXRlZ3kgLSBTdHJhdGVneSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIHN0cmF0ZWd5IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5GYWN0b3J5KGFyZ3MpIHtcbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuX3J1bkZhY3RvcnlJbnZvY2F0aW9uKGFyZ3MpKS5yZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBldmVudC10cmFja2VkIGludm9jYXRpb24sIG9wdGlvbmFsbHkgcmV1c2luZyBkZWNsYXJhdGlvbiBwbGFubmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWN0b3J5TmFtZSAtIEZhY3RvcnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy50cmFpdHMgLSBPcmRlcmVkIHRyYWl0cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mub3ZlcnJpZGVzIC0gT3ZlcnJpZGVzLlxuICAgKiBAcGFyYW0ge1wiYXR0cmlidXRlc0ZvclwiIHwgXCJidWlsZFwiIHwgXCJjcmVhdGVcIn0gYXJncy5zdHJhdGVneSAtIFN0cmF0ZWd5IG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IFthcmdzLnBsYW5UZW1wbGF0ZV0gLSBSZXVzYWJsZSBkZWNsYXJhdGlvbiBwbGFuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7cmVzdWx0OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcGxhblRlbXBsYXRlOiBpbXBvcnQoXCIuL2ZhY3RvcnktcnVubmVyLmpzXCIpLkNvbXBpbGVkUGxhbn0+fSAtIFJlc3VsdCBhbmQgZGVjbGFyYXRpb24gcGxhbi5cbiAgICovXG4gIGFzeW5jIF9ydW5GYWN0b3J5SW52b2NhdGlvbih7ZmFjdG9yeU5hbWUsIHRyYWl0cywgb3ZlcnJpZGVzLCBzdHJhdGVneSwgcGxhblRlbXBsYXRlfSkge1xuICAgIHRoaXMuX2FjdGl2ZUV2YWx1YXRpb25zICs9IDFcblxuICAgIGNvbnN0IGludm9jYXRpb25JZCA9IHRoaXMuX2V2ZW50cy5uZXh0SW52b2NhdGlvbklkKClcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5fZXZlbnRzLmVtaXQoXCJzdGFydFwiLCB7aW52b2NhdGlvbklkLCBmYWN0b3J5OiBmYWN0b3J5TmFtZSwgc3RyYXRlZ3ksIHRyYWl0c30pXG5cbiAgICAgIGNvbnN0IGNvbXBpbGVkUGxhblRlbXBsYXRlID0gcGxhblRlbXBsYXRlIHx8IHRoaXMuX3J1bm5lci5jb21waWxlVGVtcGxhdGUoZmFjdG9yeU5hbWUsIHRyYWl0cylcbiAgICAgIGNvbnN0IGNvbXBpbGVkUGxhbiA9IHRoaXMuX3J1bm5lci5hcHBseU92ZXJyaWRlcyhjb21waWxlZFBsYW5UZW1wbGF0ZSwgb3ZlcnJpZGVzKVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fc3RyYXRlZ2llc1tzdHJhdGVneV0ucnVuKHtyZWdpc3RyeTogdGhpcywgcGxhbjogY29tcGlsZWRQbGFufSlcblxuICAgICAgdGhpcy5fZXZlbnRzLmVtaXQoXCJzdWNjZXNzXCIsIHtpbnZvY2F0aW9uSWQsIGZhY3Rvcnk6IGZhY3RvcnlOYW1lLCBzdHJhdGVneSwgdHJhaXRzLCBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0fSlcblxuICAgICAgcmV0dXJuIHtyZXN1bHQsIHBsYW5UZW1wbGF0ZTogY29tcGlsZWRQbGFuVGVtcGxhdGV9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2V2ZW50cy5lbWl0KFwiZmFpbHVyZVwiLCB7aW52b2NhdGlvbklkLCBmYWN0b3J5OiBmYWN0b3J5TmFtZSwgc3RyYXRlZ3ksIHRyYWl0cywgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCwgZXJyb3J9KVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9hY3RpdmVFdmFsdWF0aW9ucyAtPSAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhbiBpbW11dGFibGUgZmFjdG9yeSBkZWZpbml0aW9uIGFuZCBpdHMgYWxpYXNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2ZhY3RvcnktZGVmaW5pdGlvbi5qc1wiKS5kZWZhdWx0fSBkZWZpbml0aW9uIC0gQ29tcGlsZWQgZmFjdG9yeS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVnaXN0ZXJGYWN0b3J5RGVmaW5pdGlvbihkZWZpbml0aW9uKSB7XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIFtkZWZpbml0aW9uLm5hbWUsIC4uLmRlZmluaXRpb24uYWxpYXNlc10pIHtcbiAgICAgIGlmICh0aGlzLl9mYWN0b3JpZXMuaGFzKG5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBEdXBsaWNhdGVEZWZpbml0aW9uRXJyb3IoYEZhY3RvcnkgXCIke25hbWV9XCIgaXMgYWxyZWFkeSByZWdpc3RlcmVkYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgW2RlZmluaXRpb24ubmFtZSwgLi4uZGVmaW5pdGlvbi5hbGlhc2VzXSkge1xuICAgICAgdGhpcy5fZmFjdG9yaWVzLnNldChuYW1lLCBkZWZpbml0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyBhbiBleGlzdGluZyBmYWN0b3J5IGRlZmluaXRpb24gKGFuZCBpdHMgYWxpYXNlcykgd2l0aCBhIHJlY29tcGlsZWRcbiAgICogb25lLiBVc2VkIGJ5IGBtb2RpZnlgOyBubyBkdXBsaWNhdGUgY2hlY2sgYmVjYXVzZSBpdCBpbnRlbnRpb25hbGx5IG92ZXJ3cml0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdH0gZGVmaW5pdGlvbiAtIFJlY29tcGlsZWQgZmFjdG9yeS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwbGFjZUZhY3RvcnlEZWZpbml0aW9uKGRlZmluaXRpb24pIHtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgW2RlZmluaXRpb24ubmFtZSwgLi4uZGVmaW5pdGlvbi5hbGlhc2VzXSkge1xuICAgICAgdGhpcy5fZmFjdG9yaWVzLnNldChuYW1lLCBkZWZpbml0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBnbG9iYWwgdHJhaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90cmFpdC1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHR9IHRyYWl0IC0gQ29tcGlsZWQgdHJhaXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlZ2lzdGVyR2xvYmFsVHJhaXQodHJhaXQpIHtcbiAgICBpZiAodGhpcy5fZ2xvYmFsVHJhaXRzLmhhcyh0cmFpdC5uYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IER1cGxpY2F0ZURlZmluaXRpb25FcnJvcihgVHJhaXQgXCIke3RyYWl0Lm5hbWV9XCIgaXMgYWxyZWFkeSByZWdpc3RlcmVkYClcbiAgICB9XG5cbiAgICB0aGlzLl9nbG9iYWxUcmFpdHMuc2V0KHRyYWl0Lm5hbWUsIHRyYWl0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIHNlcXVlbmNlIChhbmQgaXRzIGFsaWFzZXMpIGVpdGhlciBnbG9iYWxseSBvciB1bmRlciBhIGZhY3Rvcnkgc2NvcGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zZXF1ZW5jZS5qc1wiKS5kZWZhdWx0fSBzZXF1ZW5jZSAtIFNlcXVlbmNlIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGZhY3RvcnlTY29wZSAtIEZhY3RvcnkgbmFtZSB0byBzY29wZSB1bmRlciwgb3IgbnVsbCBmb3IgZ2xvYmFsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWdpc3RlclNlcXVlbmNlKHNlcXVlbmNlLCBmYWN0b3J5U2NvcGUpIHtcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vc2VxdWVuY2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgbGV0IHRhcmdldFxuXG4gICAgaWYgKGZhY3RvcnlTY29wZSkge1xuICAgICAgaWYgKCF0aGlzLl9mYWN0b3J5U2VxdWVuY2VzLmhhcyhmYWN0b3J5U2NvcGUpKSB0aGlzLl9mYWN0b3J5U2VxdWVuY2VzLnNldChmYWN0b3J5U2NvcGUsIG5ldyBNYXAoKSlcbiAgICAgIHRhcmdldCA9IC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi9zZXF1ZW5jZS5qc1wiKS5kZWZhdWx0Pn0gKi8gKHRoaXMuX2ZhY3RvcnlTZXF1ZW5jZXMuZ2V0KGZhY3RvcnlTY29wZSkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldCA9IHRoaXMuX3NlcXVlbmNlc1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBbc2VxdWVuY2UubmFtZSwgLi4uc2VxdWVuY2UuYWxpYXNlc10pIHtcbiAgICAgIGlmICh0YXJnZXQuaGFzKG5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBEdXBsaWNhdGVEZWZpbml0aW9uRXJyb3IoYFNlcXVlbmNlIFwiJHtuYW1lfVwiIGlzIGFscmVhZHkgcmVnaXN0ZXJlZCR7ZmFjdG9yeVNjb3BlID8gYCBmb3IgZmFjdG9yeSBcIiR7ZmFjdG9yeVNjb3BlfVwiYCA6IFwiXCJ9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgW3NlcXVlbmNlLm5hbWUsIC4uLnNlcXVlbmNlLmFsaWFzZXNdKSB7XG4gICAgICB0YXJnZXQuc2V0KG5hbWUsIHNlcXVlbmNlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmRzIGEgcmVnaXN0cnktbGV2ZWwgZGVmYXVsdCBkZWNsYXJhdGlvbiAoY2FsbGJhY2tzL2NvbnN0cnVjdGlvbiBkZWZhdWx0cykuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuRGVjbGFyYXRpb259IGRlY2xhcmF0aW9uIC0gRGVjbGFyYXRpb24gdG8gYWRkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hZGRHbG9iYWxEZWNsYXJhdGlvbihkZWNsYXJhdGlvbikge1xuICAgIHRoaXMuX2dsb2JhbERlY2xhcmF0aW9ucy5wdXNoKGRlY2xhcmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgc2VxdWVuY2UgbmFtZSBhZ2FpbnN0IGEgZmFjdG9yeSBzY29wZSBjaGFpbiAoY2hpbGQgZmlyc3QpIHRoZW4gdGhlXG4gICAqIGdsb2JhbCBzY29wZSBhbmQgYWR2YW5jZXMgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXF1ZW5jZU5hbWUgLSBTZXF1ZW5jZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBjaGFpbk5hbWVzIC0gSW5oZXJpdGFuY2UgY2hhaW4gbmFtZXMgKGNoaWxkIGxhc3QpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGZvcm1hdHRlZCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIF9nZW5lcmF0ZVNjb3BlZChzZXF1ZW5jZU5hbWUsIGNoYWluTmFtZXMpIHtcbiAgICBmb3IgKGxldCBpbmRleCA9IGNoYWluTmFtZXMubGVuZ3RoIC0gMTsgaW5kZXggPj0gMDsgaW5kZXgtLSkge1xuICAgICAgY29uc3Qgc2NvcGUgPSB0aGlzLl9mYWN0b3J5U2VxdWVuY2VzLmdldChjaGFpbk5hbWVzW2luZGV4XSlcblxuICAgICAgaWYgKHNjb3BlICYmIHNjb3BlLmhhcyhzZXF1ZW5jZU5hbWUpKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCAvKiogQHR5cGUge2ltcG9ydChcIi4vc2VxdWVuY2UuanNcIikuZGVmYXVsdH0gKi8gKHNjb3BlLmdldChzZXF1ZW5jZU5hbWUpKS5uZXh0KClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcmVzb2x2ZUdsb2JhbFNlcXVlbmNlKHNlcXVlbmNlTmFtZSkubmV4dCgpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBnbG9iYWwgc2VxdWVuY2UgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlcXVlbmNlTmFtZSAtIFNlcXVlbmNlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3NlcXVlbmNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHNlcXVlbmNlLlxuICAgKi9cbiAgX3Jlc29sdmVHbG9iYWxTZXF1ZW5jZShzZXF1ZW5jZU5hbWUpIHtcbiAgICBjb25zdCBzZXF1ZW5jZSA9IHRoaXMuX3NlcXVlbmNlcy5nZXQoc2VxdWVuY2VOYW1lKVxuXG4gICAgaWYgKCFzZXF1ZW5jZSkge1xuICAgICAgdGhyb3cgbmV3IFVuZGVmaW5lZFNlcXVlbmNlRXJyb3IoYE5vIHNlcXVlbmNlIHJlZ2lzdGVyZWQgY2FsbGVkIFwiJHtzZXF1ZW5jZU5hbWV9XCJgKVxuICAgIH1cblxuICAgIHJldHVybiBzZXF1ZW5jZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgc2V0dXAtdGltZSBtdXRhdGlvbiB3aGlsZSBldmFsdWF0aW9ucyBhcmUgYWN0aXZlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uIC0gT3BlcmF0aW9uIG5hbWUsIGZvciB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXNzZXJ0Tm90RXZhbHVhdGluZyhvcGVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fYWN0aXZlRXZhbHVhdGlvbnMgPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgUmVnaXN0cnlCdXN5RXJyb3IoYENhbm5vdCAke29wZXJhdGlvbn0gd2hpbGUgZmFjdG9yeSBldmFsdWF0aW9ucyBhcmUgYWN0aXZlLiBSZWdpc3RyeSBtdXRhdGlvbiBpcyBzZXR1cC10aW1lIG9ubHkuYClcbiAgICB9XG4gIH1cbn1cbiJdfQ==