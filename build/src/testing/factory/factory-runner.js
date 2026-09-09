// @ts-check
import DatabaseRecord from "../../database/record/index.js";
import { FactoryCycleError, UndefinedFactoryError, UndefinedTraitError } from "./errors.js";
/**
 * A resolved attribute/transient/association slot in a compiled plan.
 * @typedef {object} Slot
 * @property {"attribute" | "transient" | "association"} slotKind - Slot nature.
 * @property {ReturnType<typeof JSON.parse>} value - Literal/lazy value, override value, or AssociationDeclaration.
 * @property {boolean} isOverride - Whether the value came from a call-site override.
 */
/**
 * The immutable result of compiling a factory invocation.
 * @typedef {object} CompiledPlan
 * @property {string} factoryName - Target factory name.
 * @property {import("./factory-definition.js").default} factoryDefinition - Target definition.
 * @property {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} modelClass - Resolved model class.
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
        this.registry = registry;
    }
    /**
     * Compiles a factory invocation into a plan.
     * @param {string} factoryName - Factory to run.
     * @param {string[]} requestedTraits - Traits requested at the call site, in order.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Call-site overrides (highest precedence).
     * @returns {CompiledPlan} - The compiled plan.
     */
    compile(factoryName, requestedTraits, overrides) {
        return this.applyOverrides(this.compileTemplate(factoryName, requestedTraits), overrides);
    }
    /**
     * Compiles inheritance, traits and declarations without call-site overrides.
     * @param {string} factoryName - Factory to run.
     * @param {string[]} requestedTraits - Traits requested at the call site, in order.
     * @returns {CompiledPlan} - Reusable declaration plan.
     */
    compileTemplate(factoryName, requestedTraits) {
        const chain = this._resolveChain(factoryName);
        const target = chain[chain.length - 1];
        const modelClass = this._resolveModelClass(chain);
        /** @type {Array<{decl: import("./declarations.js").Declaration}>} */
        const flattened = [];
        for (const declaration of this.registry._globalDeclarations) {
            flattened.push({ decl: declaration });
        }
        for (const factoryDefinition of chain) {
            this._expandFactoryDeclarations(factoryDefinition, factoryDefinition, flattened);
        }
        for (const traitName of requestedTraits) {
            this._expandTrait(traitName, target, flattened, []);
        }
        return this._buildPlan({ flattened, modelClass, target, chainNames: chain.map((definition) => definition.name) });
    }
    /**
     * Applies the current call-site overrides without mutating the reusable template.
     * @param {CompiledPlan} planTemplate - Reusable declaration plan.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Current call-site overrides.
     * @returns {CompiledPlan} - Per-invocation plan.
     */
    applyOverrides(planTemplate, overrides) {
        const overrideKeys = Object.keys(overrides);
        if (overrideKeys.length === 0)
            return planTemplate;
        const resolved = new Map(planTemplate.resolved);
        for (const key of overrideKeys) {
            const prior = resolved.get(key);
            resolved.set(key, { slotKind: prior ? prior.slotKind : "attribute", value: overrides[key], isOverride: true });
        }
        this._arbitrateAssociationOverrides(resolved, overrides, planTemplate.modelClass);
        return { ...planTemplate, resolved };
    }
    /**
     * Resolves the inheritance chain from the root parent down to the target.
     * @param {string} factoryName - Target factory name.
     * @returns {import("./factory-definition.js").default[]} - Chain (root first, target last).
     */
    _resolveChain(factoryName) {
        /** @type {import("./factory-definition.js").default[]} */
        const chain = [];
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {import("./factory-definition.js").default | null} */
        let current = this._resolveFactory(factoryName);
        while (current) {
            if (seen.has(current.name)) {
                throw new FactoryCycleError(`Factory inheritance cycle detected: ${[...seen, current.name].join(" -> ")}`);
            }
            seen.add(current.name);
            chain.unshift(current);
            current = current.parentName ? this._resolveFactory(current.parentName) : null;
        }
        return chain;
    }
    /**
     * Resolves a factory definition by name (or alias).
     * @param {string} factoryName - Factory name.
     * @returns {import("./factory-definition.js").default} - The definition.
     */
    _resolveFactory(factoryName) {
        const definition = this.registry._factories.get(factoryName);
        if (!definition) {
            throw new UndefinedFactoryError(`No factory registered called "${factoryName}". Registered: ${[...this.registry._factories.keys()].join(", ") || "(none)"}`);
        }
        return definition;
    }
    /**
     * Picks the nearest declared model class in the chain (child overrides parent).
     * @param {import("./factory-definition.js").default[]} chain - Inheritance chain.
     * @returns {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} - The model class, or null.
     */
    _resolveModelClass(chain) {
        for (let index = chain.length - 1; index >= 0; index--) {
            if (chain[index].modelClass)
                return chain[index].modelClass;
        }
        return null;
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
                this._expandTrait(declaration.name, scope, out, []);
            }
            else {
                out.push({ decl: declaration });
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
            throw new FactoryCycleError(`Trait inclusion cycle detected: ${[...activePath, traitName].join(" -> ")}`);
        }
        const localTrait = this._resolveLocalTrait(traitName, scope);
        const trait = localTrait?.trait || this.registry._globalTraits.get(traitName);
        const inclusionScope = localTrait?.scope || scope;
        if (!trait) {
            throw new UndefinedTraitError(`No trait registered called "${traitName}" for factory "${scope.name}"`);
        }
        for (const declaration of trait.declarations) {
            if (declaration.kind === "traitInclude") {
                this._expandTrait(declaration.name, inclusionScope, out, [...activePath, traitName]);
            }
            else {
                out.push({ decl: declaration });
            }
        }
    }
    /**
     * Resolves a local trait from the current factory upward through its parents.
     * @param {string} traitName - Trait name to resolve.
     * @param {import("./factory-definition.js").default} scope - Declaring/requesting factory scope.
     * @returns {{trait: import("./trait-definition.js").default, scope: import("./factory-definition.js").default} | undefined} - Nearest local trait and its declaring scope, if any.
     */
    _resolveLocalTrait(traitName, scope) {
        /** @type {import("./factory-definition.js").default | undefined} */
        let current = scope;
        while (current) {
            const trait = current.localTraits.get(traitName);
            if (trait)
                return { trait, scope: current };
            current = current.parentName ? this._resolveFactory(current.parentName) : undefined;
        }
        return undefined;
    }
    /**
     * Folds flattened declarations into a reusable compiled plan.
     * @param {object} args - Options.
     * @param {Array<{decl: import("./declarations.js").Declaration}>} args.flattened - Flattened declarations.
     * @param {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} args.modelClass - Resolved model class.
     * @param {import("./factory-definition.js").default} args.target - Target factory definition.
     * @param {string[]} args.chainNames - Inheritance chain names.
     * @returns {CompiledPlan} - The compiled plan.
     */
    _buildPlan({ flattened, modelClass, target, chainNames }) {
        /** @type {Map<string, Slot>} */
        const resolved = new Map();
        /** @type {Map<string, import("./declarations.js").CallbackDeclaration[]>} */
        const callbacks = new Map();
        /** @type {Set<import("./declarations.js").CallbackDeclaration>} */
        const seenCallbacks = new Set();
        /** @type {import("./declarations.js").InitializeWithDeclaration["fn"] | null} */
        let initializeWith = null;
        /** @type {import("./declarations.js").ToCreateDeclaration["fn"] | null} */
        let toCreate = null;
        let skipCreate = false;
        for (const { decl } of flattened) {
            if (decl.kind === "attribute") {
                resolved.set(decl.name, { slotKind: decl.isTransient ? "transient" : "attribute", value: decl.value, isOverride: false });
            }
            else if (decl.kind === "association") {
                resolved.set(decl.name, { slotKind: "association", value: decl, isOverride: false });
            }
            else if (decl.kind === "callback") {
                if (!seenCallbacks.has(decl)) {
                    seenCallbacks.add(decl);
                    const eventCallbacks = callbacks.get(decl.event) || [];
                    eventCallbacks.push(decl);
                    callbacks.set(decl.event, eventCallbacks);
                }
            }
            else if (decl.kind === "initializeWith") {
                initializeWith = decl.fn;
            }
            else if (decl.kind === "toCreate") {
                toCreate = decl.fn;
            }
            else if (decl.kind === "skipCreate") {
                skipCreate = true;
            }
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
        };
    }
    /**
     * Applies belongs-to override precedence using the declared model relationship's
     * real foreign-key metadata. An explicit association object wins over its key;
     * otherwise an explicit key suppresses the factory-declared association.
     * @param {Map<string, Slot>} resolved - Folded slots.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} overrides - Call-site overrides.
     * @param {(new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) | null} modelClass - Resolved model class.
     * @returns {void}
     */
    _arbitrateAssociationOverrides(resolved, overrides, modelClass) {
        if (Object.keys(overrides).length === 0)
            return;
        if (typeof modelClass !== "function" || !(modelClass.prototype instanceof DatabaseRecord))
            return;
        const backendModelClass = /** @type {typeof DatabaseRecord} */ (modelClass);
        const columnToAttribute = backendModelClass.getColumnNameToAttributeNameMap();
        for (const [name, slot] of [...resolved]) {
            if (slot.slotKind !== "association")
                continue;
            const relationship = backendModelClass.getRelationshipByName(name);
            if (relationship.getType() !== "belongsTo")
                continue;
            const foreignKeyColumn = relationship.getForeignKey();
            const foreignKeyAttribute = columnToAttribute[foreignKeyColumn] || foreignKeyColumn;
            if (!Object.hasOwn(overrides, foreignKeyAttribute))
                continue;
            if (slot.isOverride) {
                resolved.delete(foreignKeyAttribute);
            }
            else {
                resolved.delete(name);
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFjdG9yeS1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9mYWN0b3J5L2ZhY3RvcnktcnVubmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGNBQWMsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUMzRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUscUJBQXFCLEVBQUUsbUJBQW1CLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFekY7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7Ozs7OztHQVlHO0FBRUg7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7O09BR0c7SUFDSCxZQUFZLFFBQVE7UUFDbEIseUVBQXlFO1FBQ3pFLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxPQUFPLENBQUMsV0FBVyxFQUFFLGVBQWUsRUFBRSxTQUFTO1FBQzdDLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRSxlQUFlLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQTtJQUMzRixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxlQUFlLENBQUMsV0FBVyxFQUFFLGVBQWU7UUFDMUMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUM3QyxNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUN0QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFakQscUVBQXFFO1FBQ3JFLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQTtRQUVwQixLQUFLLE1BQU0sV0FBVyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsbUJBQW1CLEVB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QUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUM7Z0JBQUUsU0FBUTtZQUU1RCxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDcEIsUUFBUSxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1lBQ3RDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ3ZCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBEYXRhYmFzZVJlY29yZCBmcm9tIFwiLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCB7RmFjdG9yeUN5Y2xlRXJyb3IsIFVuZGVmaW5lZEZhY3RvcnlFcnJvciwgVW5kZWZpbmVkVHJhaXRFcnJvcn0gZnJvbSBcIi4vZXJyb3JzLmpzXCJcblxuLyoqXG4gKiBBIHJlc29sdmVkIGF0dHJpYnV0ZS90cmFuc2llbnQvYXNzb2NpYXRpb24gc2xvdCBpbiBhIGNvbXBpbGVkIHBsYW4uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTbG90XG4gKiBAcHJvcGVydHkge1wiYXR0cmlidXRlXCIgfCBcInRyYW5zaWVudFwiIHwgXCJhc3NvY2lhdGlvblwifSBzbG90S2luZCAtIFNsb3QgbmF0dXJlLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBMaXRlcmFsL2xhenkgdmFsdWUsIG92ZXJyaWRlIHZhbHVlLCBvciBBc3NvY2lhdGlvbkRlY2xhcmF0aW9uLlxuICogQHByb3BlcnR5IHtib29sZWFufSBpc092ZXJyaWRlIC0gV2hldGhlciB0aGUgdmFsdWUgY2FtZSBmcm9tIGEgY2FsbC1zaXRlIG92ZXJyaWRlLlxuICovXG5cbi8qKlxuICogVGhlIGltbXV0YWJsZSByZXN1bHQgb2YgY29tcGlsaW5nIGEgZmFjdG9yeSBpbnZvY2F0aW9uLlxuICogQHR5cGVkZWYge29iamVjdH0gQ29tcGlsZWRQbGFuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZmFjdG9yeU5hbWUgLSBUYXJnZXQgZmFjdG9yeSBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2ZhY3RvcnktZGVmaW5pdGlvbi5qc1wiKS5kZWZhdWx0fSBmYWN0b3J5RGVmaW5pdGlvbiAtIFRhcmdldCBkZWZpbml0aW9uLlxuICogQHByb3BlcnR5IHsobmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgfCBudWxsfSBtb2RlbENsYXNzIC0gUmVzb2x2ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBjaGFpbk5hbWVzIC0gSW5oZXJpdGFuY2UgY2hhaW4gbmFtZXMgKGNoaWxkIGxhc3QpIGZvciBzZXF1ZW5jZSBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgU2xvdD59IHJlc29sdmVkIC0gTmFtZeKGknNsb3QgbWFwIChsYXN0IGRlY2xhcmF0aW9uIHdpbnMpLlxuICogQHByb3BlcnR5IHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5DYWxsYmFja0RlY2xhcmF0aW9uW10+fSBjYWxsYmFja3MgLSBEZWR1cGVkIGNhbGxiYWNrcyBieSBldmVudC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuSW5pdGlhbGl6ZVdpdGhEZWNsYXJhdGlvbltcImZuXCJdIHwgbnVsbH0gaW5pdGlhbGl6ZVdpdGggLSBDdXN0b20gY29uc3RydWN0b3IsIG9yIG51bGwuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vZGVjbGFyYXRpb25zLmpzXCIpLlRvQ3JlYXRlRGVjbGFyYXRpb25bXCJmblwiXSB8IG51bGx9IHRvQ3JlYXRlIC0gQ3VzdG9tIHBlcnNpc3RlbmNlLCBvciBudWxsLlxuICogQHByb3BlcnR5IHtib29sZWFufSBza2lwQ3JlYXRlIC0gV2hldGhlciBwZXJzaXN0ZW5jZSBpcyBza2lwcGVkLlxuICovXG5cbi8qKlxuICogQ29tcGlsZXMgZmFjdG9yeSBpbnZvY2F0aW9ucyBpbnRvIGltbXV0YWJsZSBwbGFucyBieSByZXNvbHZpbmcgdGhlIGluaGVyaXRhbmNlXG4gKiBjaGFpbiwgZXhwYW5kaW5nIGJhc2UgYW5kIHJlcXVlc3RlZCB0cmFpdHMsIGFuZCBmb2xkaW5nIGRlY2xhcmF0aW9ucyBpbnRvIGFcbiAqIG5hbWXihpJzbG90IG1hcCBwbHVzIGEgZGVkdXBlZCwgb3JkZXJlZCBjYWxsYmFjayBzZXQuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZhY3RvcnlSdW5uZXIge1xuICAvKipcbiAgICogQnVpbGRzIGEgcnVubmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZmFjdG9yeS1yZWdpc3RyeS5qc1wiKS5kZWZhdWx0fSByZWdpc3RyeSAtIE93bmluZyByZWdpc3RyeS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHJlZ2lzdHJ5KSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2ZhY3RvcnktcmVnaXN0cnkuanNcIikuZGVmYXVsdH0gLSBPd25pbmcgcmVnaXN0cnkuICovXG4gICAgdGhpcy5yZWdpc3RyeSA9IHJlZ2lzdHJ5XG4gIH1cblxuICAvKipcbiAgICogQ29tcGlsZXMgYSBmYWN0b3J5IGludm9jYXRpb24gaW50byBhIHBsYW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmYWN0b3J5TmFtZSAtIEZhY3RvcnkgdG8gcnVuLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSByZXF1ZXN0ZWRUcmFpdHMgLSBUcmFpdHMgcmVxdWVzdGVkIGF0IHRoZSBjYWxsIHNpdGUsIGluIG9yZGVyLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3ZlcnJpZGVzIC0gQ2FsbC1zaXRlIG92ZXJyaWRlcyAoaGlnaGVzdCBwcmVjZWRlbmNlKS5cbiAgICogQHJldHVybnMge0NvbXBpbGVkUGxhbn0gLSBUaGUgY29tcGlsZWQgcGxhbi5cbiAgICovXG4gIGNvbXBpbGUoZmFjdG9yeU5hbWUsIHJlcXVlc3RlZFRyYWl0cywgb3ZlcnJpZGVzKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHlPdmVycmlkZXModGhpcy5jb21waWxlVGVtcGxhdGUoZmFjdG9yeU5hbWUsIHJlcXVlc3RlZFRyYWl0cyksIG92ZXJyaWRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21waWxlcyBpbmhlcml0YW5jZSwgdHJhaXRzIGFuZCBkZWNsYXJhdGlvbnMgd2l0aG91dCBjYWxsLXNpdGUgb3ZlcnJpZGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmFjdG9yeU5hbWUgLSBGYWN0b3J5IHRvIHJ1bi5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcmVxdWVzdGVkVHJhaXRzIC0gVHJhaXRzIHJlcXVlc3RlZCBhdCB0aGUgY2FsbCBzaXRlLCBpbiBvcmRlci5cbiAgICogQHJldHVybnMge0NvbXBpbGVkUGxhbn0gLSBSZXVzYWJsZSBkZWNsYXJhdGlvbiBwbGFuLlxuICAgKi9cbiAgY29tcGlsZVRlbXBsYXRlKGZhY3RvcnlOYW1lLCByZXF1ZXN0ZWRUcmFpdHMpIHtcbiAgICBjb25zdCBjaGFpbiA9IHRoaXMuX3Jlc29sdmVDaGFpbihmYWN0b3J5TmFtZSlcbiAgICBjb25zdCB0YXJnZXQgPSBjaGFpbltjaGFpbi5sZW5ndGggLSAxXVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLl9yZXNvbHZlTW9kZWxDbGFzcyhjaGFpbilcblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2RlY2w6IGltcG9ydChcIi4vZGVjbGFyYXRpb25zLmpzXCIpLkRlY2xhcmF0aW9ufT59ICovXG4gICAgY29uc3QgZmxhdHRlbmVkID0gW11cblxuICAgIGZvciAoY29uc3QgZGVjbGFyYXRpb24gb2YgdGhpcy5yZWdpc3RyeS5fZ2xvYmFsRGVjbGFyYXRpb25zKSB7XG4gICAgICBmbGF0dGVuZWQucHVzaCh7ZGVjbDogZGVjbGFyYXRpb259KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmFjdG9yeURlZmluaXRpb24gb2YgY2hhaW4pIHtcbiAgICAgIHRoaXMuX2V4cGFuZEZhY3RvcnlEZWNsYXJhdGlvbnMoZmFjdG9yeURlZmluaXRpb24sIGZhY3RvcnlEZWZpbml0aW9uLCBmbGF0dGVuZWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0cmFpdE5hbWUgb2YgcmVxdWVzdGVkVHJhaXRzKSB7XG4gICAgICB0aGlzLl9leHBhbmRUcmFpdCh0cmFpdE5hbWUsIHRhcmdldCwgZmxhdHRlbmVkLCBbXSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYnVpbGRQbGFuKHtmbGF0dGVuZWQsIG1vZGVsQ2xhc3MsIHRhcmdldCwgY2hhaW5OYW1lczogY2hhaW4ubWFwKChkZWZpbml0aW9uKSA9PiBkZWZpbml0aW9uLm5hbWUpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBjdXJyZW50IGNhbGwtc2l0ZSBvdmVycmlkZXMgd2l0aG91dCBtdXRhdGluZyB0aGUgcmV1c2FibGUgdGVtcGxhdGUuXG4gICAqIEBwYXJhbSB7Q29tcGlsZWRQbGFufSBwbGFuVGVtcGxhdGUgLSBSZXVzYWJsZSBkZWNsYXJhdGlvbiBwbGFuLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3ZlcnJpZGVzIC0gQ3VycmVudCBjYWxsLXNpdGUgb3ZlcnJpZGVzLlxuICAgKiBAcmV0dXJucyB7Q29tcGlsZWRQbGFufSAtIFBlci1pbnZvY2F0aW9uIHBsYW4uXG4gICAqL1xuICBhcHBseU92ZXJyaWRlcyhwbGFuVGVtcGxhdGUsIG92ZXJyaWRlcykge1xuICAgIGNvbnN0IG92ZXJyaWRlS2V5cyA9IE9iamVjdC5rZXlzKG92ZXJyaWRlcylcblxuICAgIGlmIChvdmVycmlkZUtleXMubGVuZ3RoID09PSAwKSByZXR1cm4gcGxhblRlbXBsYXRlXG5cbiAgICBjb25zdCByZXNvbHZlZCA9IG5ldyBNYXAocGxhblRlbXBsYXRlLnJlc29sdmVkKVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2Ygb3ZlcnJpZGVLZXlzKSB7XG4gICAgICBjb25zdCBwcmlvciA9IHJlc29sdmVkLmdldChrZXkpXG5cbiAgICAgIHJlc29sdmVkLnNldChrZXksIHtzbG90S2luZDogcHJpb3IgPyBwcmlvci5zbG90S2luZCA6IFwiYXR0cmlidXRlXCIsIHZhbHVlOiBvdmVycmlkZXNba2V5XSwgaXNPdmVycmlkZTogdHJ1ZX0pXG4gICAgfVxuXG4gICAgdGhpcy5fYXJiaXRyYXRlQXNzb2NpYXRpb25PdmVycmlkZXMocmVzb2x2ZWQsIG92ZXJyaWRlcywgcGxhblRlbXBsYXRlLm1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gey4uLnBsYW5UZW1wbGF0ZSwgcmVzb2x2ZWR9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGluaGVyaXRhbmNlIGNoYWluIGZyb20gdGhlIHJvb3QgcGFyZW50IGRvd24gdG8gdGhlIHRhcmdldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gVGFyZ2V0IGZhY3RvcnkgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHRbXX0gLSBDaGFpbiAocm9vdCBmaXJzdCwgdGFyZ2V0IGxhc3QpLlxuICAgKi9cbiAgX3Jlc29sdmVDaGFpbihmYWN0b3J5TmFtZSkge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdFtdfSAqL1xuICAgIGNvbnN0IGNoYWluID0gW11cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIGxldCBjdXJyZW50ID0gdGhpcy5fcmVzb2x2ZUZhY3RvcnkoZmFjdG9yeU5hbWUpXG5cbiAgICB3aGlsZSAoY3VycmVudCkge1xuICAgICAgaWYgKHNlZW4uaGFzKGN1cnJlbnQubmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEZhY3RvcnlDeWNsZUVycm9yKGBGYWN0b3J5IGluaGVyaXRhbmNlIGN5Y2xlIGRldGVjdGVkOiAke1suLi5zZWVuLCBjdXJyZW50Lm5hbWVdLmpvaW4oXCIgLT4gXCIpfWApXG4gICAgICB9XG5cbiAgICAgIHNlZW4uYWRkKGN1cnJlbnQubmFtZSlcbiAgICAgIGNoYWluLnVuc2hpZnQoY3VycmVudClcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnBhcmVudE5hbWUgPyB0aGlzLl9yZXNvbHZlRmFjdG9yeShjdXJyZW50LnBhcmVudE5hbWUpIDogbnVsbFxuICAgIH1cblxuICAgIHJldHVybiBjaGFpblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZmFjdG9yeSBkZWZpbml0aW9uIGJ5IG5hbWUgKG9yIGFsaWFzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gRmFjdG9yeSBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgZGVmaW5pdGlvbi5cbiAgICovXG4gIF9yZXNvbHZlRmFjdG9yeShmYWN0b3J5TmFtZSkge1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSB0aGlzLnJlZ2lzdHJ5Ll9mYWN0b3JpZXMuZ2V0KGZhY3RvcnlOYW1lKVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgVW5kZWZpbmVkRmFjdG9yeUVycm9yKGBObyBmYWN0b3J5IHJlZ2lzdGVyZWQgY2FsbGVkIFwiJHtmYWN0b3J5TmFtZX1cIi4gUmVnaXN0ZXJlZDogJHtbLi4udGhpcy5yZWdpc3RyeS5fZmFjdG9yaWVzLmtleXMoKV0uam9pbihcIiwgXCIpIHx8IFwiKG5vbmUpXCJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gZGVmaW5pdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFBpY2tzIHRoZSBuZWFyZXN0IGRlY2xhcmVkIG1vZGVsIGNsYXNzIGluIHRoZSBjaGFpbiAoY2hpbGQgb3ZlcnJpZGVzIHBhcmVudCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdFtdfSBjaGFpbiAtIEluaGVyaXRhbmNlIGNoYWluLlxuICAgKiBAcmV0dXJucyB7KG5ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pIHwgbnVsbH0gLSBUaGUgbW9kZWwgY2xhc3MsIG9yIG51bGwuXG4gICAqL1xuICBfcmVzb2x2ZU1vZGVsQ2xhc3MoY2hhaW4pIHtcbiAgICBmb3IgKGxldCBpbmRleCA9IGNoYWluLmxlbmd0aCAtIDE7IGluZGV4ID49IDA7IGluZGV4LS0pIHtcbiAgICAgIGlmIChjaGFpbltpbmRleF0ubW9kZWxDbGFzcykgcmV0dXJuIGNoYWluW2luZGV4XS5tb2RlbENsYXNzXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHBhbmRzIG9uZSBmYWN0b3J5J3Mgb3duIGRlY2xhcmF0aW9ucywgaW5saW5pbmcgYmFzZS10cmFpdCBpbmNsdXNpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHR9IGZhY3RvcnlEZWZpbml0aW9uIC0gRmFjdG9yeSB3aG9zZSBkZWNsYXJhdGlvbnMgYXJlIGV4cGFuZGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHR9IHNjb3BlIC0gVGFyZ2V0IGZhY3RvcnkgKGZvciBsb2NhbC10cmFpdCByZXNvbHV0aW9uKS5cbiAgICogQHBhcmFtIHtBcnJheTx7ZGVjbDogaW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuRGVjbGFyYXRpb259Pn0gb3V0IC0gRmxhdHRlbmVkIG91dHB1dCBzaW5rLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9leHBhbmRGYWN0b3J5RGVjbGFyYXRpb25zKGZhY3RvcnlEZWZpbml0aW9uLCBzY29wZSwgb3V0KSB7XG4gICAgZm9yIChjb25zdCBkZWNsYXJhdGlvbiBvZiBmYWN0b3J5RGVmaW5pdGlvbi5kZWNsYXJhdGlvbnMpIHtcbiAgICAgIGlmIChkZWNsYXJhdGlvbi5raW5kID09PSBcInRyYWl0SW5jbHVkZVwiKSB7XG4gICAgICAgIHRoaXMuX2V4cGFuZFRyYWl0KGRlY2xhcmF0aW9uLm5hbWUsIHNjb3BlLCBvdXQsIFtdKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0LnB1c2goe2RlY2w6IGRlY2xhcmF0aW9ufSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXhwYW5kcyBhIHRyYWl0IChyZXNvbHZpbmcgZmFjdG9yeS1sb2NhbCBiZWZvcmUgZ2xvYmFsKSBhbmQgaXRzIGluY2x1c2lvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0cmFpdE5hbWUgLSBUcmFpdCB0byBleHBhbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdH0gc2NvcGUgLSBUYXJnZXQgZmFjdG9yeSAoZm9yIGxvY2FsLXRyYWl0IHJlc29sdXRpb24pLlxuICAgKiBAcGFyYW0ge0FycmF5PHtkZWNsOiBpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5EZWNsYXJhdGlvbn0+fSBvdXQgLSBGbGF0dGVuZWQgb3V0cHV0IHNpbmsuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFjdGl2ZVBhdGggLSBUcmFpdCBpbmNsdXNpb24gcGF0aCAoZm9yIGN5Y2xlIGRldGVjdGlvbikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2V4cGFuZFRyYWl0KHRyYWl0TmFtZSwgc2NvcGUsIG91dCwgYWN0aXZlUGF0aCkge1xuICAgIGlmIChhY3RpdmVQYXRoLmluY2x1ZGVzKHRyYWl0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBGYWN0b3J5Q3ljbGVFcnJvcihgVHJhaXQgaW5jbHVzaW9uIGN5Y2xlIGRldGVjdGVkOiAke1suLi5hY3RpdmVQYXRoLCB0cmFpdE5hbWVdLmpvaW4oXCIgLT4gXCIpfWApXG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxUcmFpdCA9IHRoaXMuX3Jlc29sdmVMb2NhbFRyYWl0KHRyYWl0TmFtZSwgc2NvcGUpXG4gICAgY29uc3QgdHJhaXQgPSBsb2NhbFRyYWl0Py50cmFpdCB8fCB0aGlzLnJlZ2lzdHJ5Ll9nbG9iYWxUcmFpdHMuZ2V0KHRyYWl0TmFtZSlcbiAgICBjb25zdCBpbmNsdXNpb25TY29wZSA9IGxvY2FsVHJhaXQ/LnNjb3BlIHx8IHNjb3BlXG5cbiAgICBpZiAoIXRyYWl0KSB7XG4gICAgICB0aHJvdyBuZXcgVW5kZWZpbmVkVHJhaXRFcnJvcihgTm8gdHJhaXQgcmVnaXN0ZXJlZCBjYWxsZWQgXCIke3RyYWl0TmFtZX1cIiBmb3IgZmFjdG9yeSBcIiR7c2NvcGUubmFtZX1cImApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkZWNsYXJhdGlvbiBvZiB0cmFpdC5kZWNsYXJhdGlvbnMpIHtcbiAgICAgIGlmIChkZWNsYXJhdGlvbi5raW5kID09PSBcInRyYWl0SW5jbHVkZVwiKSB7XG4gICAgICAgIHRoaXMuX2V4cGFuZFRyYWl0KGRlY2xhcmF0aW9uLm5hbWUsIGluY2x1c2lvblNjb3BlLCBvdXQsIFsuLi5hY3RpdmVQYXRoLCB0cmFpdE5hbWVdKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0LnB1c2goe2RlY2w6IGRlY2xhcmF0aW9ufSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBsb2NhbCB0cmFpdCBmcm9tIHRoZSBjdXJyZW50IGZhY3RvcnkgdXB3YXJkIHRocm91Z2ggaXRzIHBhcmVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0cmFpdE5hbWUgLSBUcmFpdCBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdH0gc2NvcGUgLSBEZWNsYXJpbmcvcmVxdWVzdGluZyBmYWN0b3J5IHNjb3BlLlxuICAgKiBAcmV0dXJucyB7e3RyYWl0OiBpbXBvcnQoXCIuL3RyYWl0LWRlZmluaXRpb24uanNcIikuZGVmYXVsdCwgc2NvcGU6IGltcG9ydChcIi4vZmFjdG9yeS1kZWZpbml0aW9uLmpzXCIpLmRlZmF1bHR9IHwgdW5kZWZpbmVkfSAtIE5lYXJlc3QgbG9jYWwgdHJhaXQgYW5kIGl0cyBkZWNsYXJpbmcgc2NvcGUsIGlmIGFueS5cbiAgICovXG4gIF9yZXNvbHZlTG9jYWxUcmFpdCh0cmFpdE5hbWUsIHNjb3BlKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2ZhY3RvcnktZGVmaW5pdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBjdXJyZW50ID0gc2NvcGVcblxuICAgIHdoaWxlIChjdXJyZW50KSB7XG4gICAgICBjb25zdCB0cmFpdCA9IGN1cnJlbnQubG9jYWxUcmFpdHMuZ2V0KHRyYWl0TmFtZSlcblxuICAgICAgaWYgKHRyYWl0KSByZXR1cm4ge3RyYWl0LCBzY29wZTogY3VycmVudH1cblxuICAgICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50TmFtZSA/IHRoaXMuX3Jlc29sdmVGYWN0b3J5KGN1cnJlbnQucGFyZW50TmFtZSkgOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogRm9sZHMgZmxhdHRlbmVkIGRlY2xhcmF0aW9ucyBpbnRvIGEgcmV1c2FibGUgY29tcGlsZWQgcGxhbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0FycmF5PHtkZWNsOiBpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5EZWNsYXJhdGlvbn0+fSBhcmdzLmZsYXR0ZW5lZCAtIEZsYXR0ZW5lZCBkZWNsYXJhdGlvbnMuXG4gICAqIEBwYXJhbSB7KG5ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pIHwgbnVsbH0gYXJncy5tb2RlbENsYXNzIC0gUmVzb2x2ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LWRlZmluaXRpb24uanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXQgLSBUYXJnZXQgZmFjdG9yeSBkZWZpbml0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNoYWluTmFtZXMgLSBJbmhlcml0YW5jZSBjaGFpbiBuYW1lcy5cbiAgICogQHJldHVybnMge0NvbXBpbGVkUGxhbn0gLSBUaGUgY29tcGlsZWQgcGxhbi5cbiAgICovXG4gIF9idWlsZFBsYW4oe2ZsYXR0ZW5lZCwgbW9kZWxDbGFzcywgdGFyZ2V0LCBjaGFpbk5hbWVzfSkge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgU2xvdD59ICovXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vZGVjbGFyYXRpb25zLmpzXCIpLkNhbGxiYWNrRGVjbGFyYXRpb25bXT59ICovXG4gICAgY29uc3QgY2FsbGJhY2tzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuQ2FsbGJhY2tEZWNsYXJhdGlvbj59ICovXG4gICAgY29uc3Qgc2VlbkNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kZWNsYXJhdGlvbnMuanNcIikuSW5pdGlhbGl6ZVdpdGhEZWNsYXJhdGlvbltcImZuXCJdIHwgbnVsbH0gKi9cbiAgICBsZXQgaW5pdGlhbGl6ZVdpdGggPSBudWxsXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RlY2xhcmF0aW9ucy5qc1wiKS5Ub0NyZWF0ZURlY2xhcmF0aW9uW1wiZm5cIl0gfCBudWxsfSAqL1xuICAgIGxldCB0b0NyZWF0ZSA9IG51bGxcbiAgICBsZXQgc2tpcENyZWF0ZSA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IHtkZWNsfSBvZiBmbGF0dGVuZWQpIHtcbiAgICAgIGlmIChkZWNsLmtpbmQgPT09IFwiYXR0cmlidXRlXCIpIHtcbiAgICAgICAgcmVzb2x2ZWQuc2V0KGRlY2wubmFtZSwge3Nsb3RLaW5kOiBkZWNsLmlzVHJhbnNpZW50ID8gXCJ0cmFuc2llbnRcIiA6IFwiYXR0cmlidXRlXCIsIHZhbHVlOiBkZWNsLnZhbHVlLCBpc092ZXJyaWRlOiBmYWxzZX0pXG4gICAgICB9IGVsc2UgaWYgKGRlY2wua2luZCA9PT0gXCJhc3NvY2lhdGlvblwiKSB7XG4gICAgICAgIHJlc29sdmVkLnNldChkZWNsLm5hbWUsIHtzbG90S2luZDogXCJhc3NvY2lhdGlvblwiLCB2YWx1ZTogZGVjbCwgaXNPdmVycmlkZTogZmFsc2V9KVxuICAgICAgfSBlbHNlIGlmIChkZWNsLmtpbmQgPT09IFwiY2FsbGJhY2tcIikge1xuICAgICAgICBpZiAoIXNlZW5DYWxsYmFja3MuaGFzKGRlY2wpKSB7XG4gICAgICAgICAgc2VlbkNhbGxiYWNrcy5hZGQoZGVjbClcblxuICAgICAgICAgIGNvbnN0IGV2ZW50Q2FsbGJhY2tzID0gY2FsbGJhY2tzLmdldChkZWNsLmV2ZW50KSB8fCBbXVxuXG4gICAgICAgICAgZXZlbnRDYWxsYmFja3MucHVzaChkZWNsKVxuICAgICAgICAgIGNhbGxiYWNrcy5zZXQoZGVjbC5ldmVudCwgZXZlbnRDYWxsYmFja3MpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZGVjbC5raW5kID09PSBcImluaXRpYWxpemVXaXRoXCIpIHtcbiAgICAgICAgaW5pdGlhbGl6ZVdpdGggPSBkZWNsLmZuXG4gICAgICB9IGVsc2UgaWYgKGRlY2wua2luZCA9PT0gXCJ0b0NyZWF0ZVwiKSB7XG4gICAgICAgIHRvQ3JlYXRlID0gZGVjbC5mblxuICAgICAgfSBlbHNlIGlmIChkZWNsLmtpbmQgPT09IFwic2tpcENyZWF0ZVwiKSB7XG4gICAgICAgIHNraXBDcmVhdGUgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZhY3RvcnlOYW1lOiB0YXJnZXQubmFtZSxcbiAgICAgIGZhY3RvcnlEZWZpbml0aW9uOiB0YXJnZXQsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgY2hhaW5OYW1lcyxcbiAgICAgIHJlc29sdmVkLFxuICAgICAgY2FsbGJhY2tzLFxuICAgICAgaW5pdGlhbGl6ZVdpdGgsXG4gICAgICB0b0NyZWF0ZSxcbiAgICAgIHNraXBDcmVhdGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBiZWxvbmdzLXRvIG92ZXJyaWRlIHByZWNlZGVuY2UgdXNpbmcgdGhlIGRlY2xhcmVkIG1vZGVsIHJlbGF0aW9uc2hpcCdzXG4gICAqIHJlYWwgZm9yZWlnbi1rZXkgbWV0YWRhdGEuIEFuIGV4cGxpY2l0IGFzc29jaWF0aW9uIG9iamVjdCB3aW5zIG92ZXIgaXRzIGtleTtcbiAgICogb3RoZXJ3aXNlIGFuIGV4cGxpY2l0IGtleSBzdXBwcmVzc2VzIHRoZSBmYWN0b3J5LWRlY2xhcmVkIGFzc29jaWF0aW9uLlxuICAgKiBAcGFyYW0ge01hcDxzdHJpbmcsIFNsb3Q+fSByZXNvbHZlZCAtIEZvbGRlZCBzbG90cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG92ZXJyaWRlcyAtIENhbGwtc2l0ZSBvdmVycmlkZXMuXG4gICAqIEBwYXJhbSB7KG5ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pIHwgbnVsbH0gbW9kZWxDbGFzcyAtIFJlc29sdmVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcmJpdHJhdGVBc3NvY2lhdGlvbk92ZXJyaWRlcyhyZXNvbHZlZCwgb3ZlcnJpZGVzLCBtb2RlbENsYXNzKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKG92ZXJyaWRlcykubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAodHlwZW9mIG1vZGVsQ2xhc3MgIT09IFwiZnVuY3Rpb25cIiB8fCAhKG1vZGVsQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgRGF0YWJhc2VSZWNvcmQpKSByZXR1cm5cblxuICAgIGNvbnN0IGJhY2tlbmRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRGF0YWJhc2VSZWNvcmR9ICovIChtb2RlbENsYXNzKVxuICAgIGNvbnN0IGNvbHVtblRvQXR0cmlidXRlID0gYmFja2VuZE1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBzbG90XSBvZiBbLi4ucmVzb2x2ZWRdKSB7XG4gICAgICBpZiAoc2xvdC5zbG90S2luZCAhPT0gXCJhc3NvY2lhdGlvblwiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBiYWNrZW5kTW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUobmFtZSlcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXlDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG4gICAgICBjb25zdCBmb3JlaWduS2V5QXR0cmlidXRlID0gY29sdW1uVG9BdHRyaWJ1dGVbZm9yZWlnbktleUNvbHVtbl0gfHwgZm9yZWlnbktleUNvbHVtblxuXG4gICAgICBpZiAoIU9iamVjdC5oYXNPd24ob3ZlcnJpZGVzLCBmb3JlaWduS2V5QXR0cmlidXRlKSkgY29udGludWVcblxuICAgICAgaWYgKHNsb3QuaXNPdmVycmlkZSkge1xuICAgICAgICByZXNvbHZlZC5kZWxldGUoZm9yZWlnbktleUF0dHJpYnV0ZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc29sdmVkLmRlbGV0ZShuYW1lKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl19