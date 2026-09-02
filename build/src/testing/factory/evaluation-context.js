// @ts-check
import { FactoryCycleError, UndefinedAttributeError } from "./errors.js";
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
    constructor({ registry, plan, strategy }) {
        /** @type {import("./factory-registry.js").default} - Owning registry. */
        this.registry = registry;
        /** @type {import("./factory-runner.js").CompiledPlan} - Compiled run plan. */
        this.plan = plan;
        /** @type {"attributesFor" | "build" | "create"} - Active strategy. */
        this.strategy = strategy;
        /** @type {Map<string, ReturnType<typeof JSON.parse>>} - Per-run memoized values / in-flight promises. */
        this._memo = new Map();
    }
    /**
     * Builds the named evaluator context handed to lazy values and callbacks for a
     * given dependency path.
     * @param {string[]} path - Current resolution path (for cycle detection).
     * @returns {{get: (name: string) => Promise<ReturnType<typeof JSON.parse>>, generate: (name: string) => Promise<ReturnType<typeof JSON.parse>>, association: (factory: string, ...args: Array<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>}} - The evaluator context.
     */
    contextFor(path) {
        return {
            get: (name) => this._get(name, path),
            generate: (name) => this.registry._generateScoped(name, this.plan.chainNames),
            association: (factory, ...args) => this._explicitAssociation(factory, args, path)
        };
    }
    /**
     * Resolves an attribute/transient/association by name, memoizing the result.
     * @param {string} name - Name to resolve.
     * @param {string[]} path - Current resolution path.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The resolved value.
     */
    _get(name, path) {
        if (path.includes(name)) {
            throw new FactoryCycleError(`Attribute dependency cycle detected: ${[...path, name].join(" -> ")}`);
        }
        if (this._memo.has(name))
            return this._memo.get(name);
        const slot = this.plan.resolved.get(name);
        if (!slot) {
            throw new UndefinedAttributeError(`Unknown attribute "${name}" referenced while evaluating factory "${this.plan.factoryName}"`);
        }
        const promise = this._evaluateSlot(slot, [...path, name]);
        this._memo.set(name, promise);
        promise.then((value) => this._memo.set(name, value), () => { });
        return promise;
    }
    /**
     * Evaluates a resolved slot, honouring lazy functions and overrides.
     * @param {import("./factory-runner.js").Slot} slot - Slot to evaluate.
     * @param {string[]} childPath - Path including this slot's name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The evaluated value.
     */
    async _evaluateSlot(slot, childPath) {
        if (slot.slotKind === "association") {
            return await this._resolveAssociationSlot(slot);
        }
        if (typeof slot.value === "function" && !slot.isOverride) {
            return await slot.value(this.contextFor(childPath));
        }
        return slot.value;
    }
    /**
     * Resolves a declared/overridden association slot. An explicit object/null
     * override suppresses nested factory execution and is returned verbatim.
     * @param {import("./factory-runner.js").Slot} slot - Association slot.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The associated record (or override value).
     */
    async _resolveAssociationSlot(slot) {
        if (slot.isOverride)
            return slot.value;
        if (this.strategy === "attributesFor")
            return null;
        const declaration = /** @type {import("./association-declaration.js").default} */ (slot.value);
        const associationStrategy = declaration.strategy || (this.strategy === "create" ? "build" : this.strategy);
        return await this.registry._runFactory({
            factoryName: declaration.factory,
            traits: declaration.traits,
            overrides: declaration.overrides,
            strategy: /** @type {"build" | "create"} */ (associationStrategy)
        });
    }
    /**
     * Runs an explicitly-invoked association from a lazy value's `association(...)`.
     * @param {string} factoryName - Factory to run.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Traits and/or an overrides object.
     * @param {string[]} _path - Current resolution path (unused; associations open a fresh run).
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - The associated record, or null under attributesFor.
     */
    _explicitAssociation(factoryName, args, _path) {
        if (this.strategy === "attributesFor")
            return Promise.resolve(null);
        /** @type {string[]} */
        const traits = [];
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        let overrides = {};
        for (const arg of args) {
            if (typeof arg === "string")
                traits.push(arg);
            else if (arg && typeof arg === "object")
                overrides = arg;
        }
        const associationStrategy = this.strategy === "create" ? "build" : this.strategy;
        return this.registry._runFactory({ factoryName, traits, overrides, strategy: associationStrategy });
    }
    /**
     * Resolves every plain attribute slot (used by attributesFor). Transients and
     * associations are omitted, though transients may still be evaluated on demand
     * as dependencies.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - The resolved attributes.
     */
    async resolveAttributes() {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const attributes = {};
        for (const [name, slot] of this.plan.resolved) {
            if (slot.slotKind === "attribute") {
                attributes[name] = await this._get(name, []);
            }
        }
        return attributes;
    }
    /**
     * Resolves every transient before callbacks that expose them as plain properties.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Evaluated transient values.
     */
    async resolveTransients() {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const transients = {};
        for (const [name, slot] of this.plan.resolved) {
            if (slot.slotKind === "transient")
                transients[name] = await this._get(name, []);
        }
        return transients;
    }
    /**
     * Resolves everything needed to construct a record: public attributes,
     * transients, and associated records.
     * @returns {Promise<{publicAttributes: Record<string, ReturnType<typeof JSON.parse>>, transients: Record<string, ReturnType<typeof JSON.parse>>, associations: Array<{name: string, record: ReturnType<typeof JSON.parse>}>}>} - Resolved construction inputs.
     */
    async resolveForConstruction() {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const publicAttributes = {};
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const transients = {};
        /** @type {Array<{name: string, record: ReturnType<typeof JSON.parse>}>} */
        const associations = [];
        for (const [name, slot] of this.plan.resolved) {
            if (slot.slotKind === "attribute") {
                publicAttributes[name] = await this._get(name, []);
            }
            else if (slot.slotKind === "transient") {
                transients[name] = await this._get(name, []);
            }
            else if (slot.slotKind === "association") {
                associations.push({ name, record: await this._get(name, []) });
            }
        }
        return { publicAttributes, transients, associations };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZhbHVhdGlvbi1jb250ZXh0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3Rlc3RpbmcvZmFjdG9yeS9ldmFsdWF0aW9uLWNvbnRleHQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxpQkFBaUIsRUFBRSx1QkFBdUIsRUFBQyxNQUFNLGFBQWEsQ0FBQTtBQUV0RTs7Ozs7O0dBTUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGlCQUFpQjtJQUNwQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUM7UUFDcEMseUVBQXlFO1FBQ3pFLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBRXhCLDhFQUE4RTtRQUM5RSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUVoQixzRUFBc0U7UUFDdEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7UUFFeEIseUdBQXlHO1FBQ3pHLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxVQUFVLENBQUMsSUFBSTtRQUNiLE9BQU87WUFDTCxHQUFHLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQztZQUNwQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQztZQUM3RSxXQUFXLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztTQUNsRixDQUFBO0lBQ0gs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QztpQkFBTSxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssYUFBYSxFQUFFLENBQUM7Z0JBQzNDLFlBQVksQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLEVBQUMsQ0FBQyxDQUFBO1lBQzlELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxFQUFDLGdCQUFnQixFQUFFLFVBQVUsRUFBRSxZQUFZLEVBQUMsQ0FBQTtJQUNyRCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtGYWN0b3J5Q3ljbGVFcnJvciwgVW5kZWZpbmVkQXR0cmlidXRlRXJyb3J9IGZyb20gXCIuL2Vycm9ycy5qc1wiXG5cbi8qKlxuICogQSBzaW5nbGUgZmFjdG9yeSBydW4ncyBldmFsdWF0aW9uIHN0YXRlLiBJdCByZXNvbHZlcyBhdHRyaWJ1dGVzL3RyYW5zaWVudHMvXG4gKiBhc3NvY2lhdGlvbnMgbGF6aWx5IGFuZCBtZW1vaXplcyBlYWNoIG5hbWUgZXhhY3RseSBvbmNlIHBlciBydW4gKHNoYXJpbmcgYW5cbiAqIGluLWZsaWdodCBwcm9taXNlIGJldHdlZW4gY29uY3VycmVudCBkZXBlbmRlbnRzKS4gQ3ljbGUgZGV0ZWN0aW9uIHVzZXMgYVxuICogcGVyLWNoYWluIHBhdGggc28gZ2VudWluZSByZWN1cnNpb24gaXMgcmVwb3J0ZWQgd2hpbGUgY29uY3VycmVudCBzaWJsaW5nIHJlYWRzXG4gKiBvZiB0aGUgc2FtZSBuYW1lIGFyZSBhbGxvd2VkLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBFdmFsdWF0aW9uQ29udGV4dCB7XG4gIC8qKlxuICAgKiBCdWlsZHMgYW4gZXZhbHVhdGlvbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LXJlZ2lzdHJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVnaXN0cnkgLSBPd25pbmcgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5Db21waWxlZFBsYW59IGFyZ3MucGxhbiAtIENvbXBpbGVkIHJ1biBwbGFuLlxuICAgKiBAcGFyYW0ge1wiYXR0cmlidXRlc0ZvclwiIHwgXCJidWlsZFwiIHwgXCJjcmVhdGVcIn0gYXJncy5zdHJhdGVneSAtIEFjdGl2ZSBzdHJhdGVneS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtyZWdpc3RyeSwgcGxhbiwgc3RyYXRlZ3l9KSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2ZhY3RvcnktcmVnaXN0cnkuanNcIikuZGVmYXVsdH0gLSBPd25pbmcgcmVnaXN0cnkuICovXG4gICAgdGhpcy5yZWdpc3RyeSA9IHJlZ2lzdHJ5XG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vZmFjdG9yeS1ydW5uZXIuanNcIikuQ29tcGlsZWRQbGFufSAtIENvbXBpbGVkIHJ1biBwbGFuLiAqL1xuICAgIHRoaXMucGxhbiA9IHBsYW5cblxuICAgIC8qKiBAdHlwZSB7XCJhdHRyaWJ1dGVzRm9yXCIgfCBcImJ1aWxkXCIgfCBcImNyZWF0ZVwifSAtIEFjdGl2ZSBzdHJhdGVneS4gKi9cbiAgICB0aGlzLnN0cmF0ZWd5ID0gc3RyYXRlZ3lcblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBlci1ydW4gbWVtb2l6ZWQgdmFsdWVzIC8gaW4tZmxpZ2h0IHByb21pc2VzLiAqL1xuICAgIHRoaXMuX21lbW8gPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG5hbWVkIGV2YWx1YXRvciBjb250ZXh0IGhhbmRlZCB0byBsYXp5IHZhbHVlcyBhbmQgY2FsbGJhY2tzIGZvciBhXG4gICAqIGdpdmVuIGRlcGVuZGVuY3kgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEN1cnJlbnQgcmVzb2x1dGlvbiBwYXRoIChmb3IgY3ljbGUgZGV0ZWN0aW9uKS5cbiAgICogQHJldHVybnMge3tnZXQ6IChuYW1lOiBzdHJpbmcpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBnZW5lcmF0ZTogKG5hbWU6IHN0cmluZykgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGFzc29jaWF0aW9uOiAoZmFjdG9yeTogc3RyaW5nLCAuLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gLSBUaGUgZXZhbHVhdG9yIGNvbnRleHQuXG4gICAqL1xuICBjb250ZXh0Rm9yKHBhdGgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZ2V0OiAobmFtZSkgPT4gdGhpcy5fZ2V0KG5hbWUsIHBhdGgpLFxuICAgICAgZ2VuZXJhdGU6IChuYW1lKSA9PiB0aGlzLnJlZ2lzdHJ5Ll9nZW5lcmF0ZVNjb3BlZChuYW1lLCB0aGlzLnBsYW4uY2hhaW5OYW1lcyksXG4gICAgICBhc3NvY2lhdGlvbjogKGZhY3RvcnksIC4uLmFyZ3MpID0+IHRoaXMuX2V4cGxpY2l0QXNzb2NpYXRpb24oZmFjdG9yeSwgYXJncywgcGF0aClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gYXR0cmlidXRlL3RyYW5zaWVudC9hc3NvY2lhdGlvbiBieSBuYW1lLCBtZW1vaXppbmcgdGhlIHJlc3VsdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lIHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBDdXJyZW50IHJlc29sdXRpb24gcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSByZXNvbHZlZCB2YWx1ZS5cbiAgICovXG4gIF9nZXQobmFtZSwgcGF0aCkge1xuICAgIGlmIChwYXRoLmluY2x1ZGVzKG5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRmFjdG9yeUN5Y2xlRXJyb3IoYEF0dHJpYnV0ZSBkZXBlbmRlbmN5IGN5Y2xlIGRldGVjdGVkOiAke1suLi5wYXRoLCBuYW1lXS5qb2luKFwiIC0+IFwiKX1gKVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9tZW1vLmhhcyhuYW1lKSkgcmV0dXJuIHRoaXMuX21lbW8uZ2V0KG5hbWUpXG5cbiAgICBjb25zdCBzbG90ID0gdGhpcy5wbGFuLnJlc29sdmVkLmdldChuYW1lKVxuXG4gICAgaWYgKCFzbG90KSB7XG4gICAgICB0aHJvdyBuZXcgVW5kZWZpbmVkQXR0cmlidXRlRXJyb3IoYFVua25vd24gYXR0cmlidXRlIFwiJHtuYW1lfVwiIHJlZmVyZW5jZWQgd2hpbGUgZXZhbHVhdGluZyBmYWN0b3J5IFwiJHt0aGlzLnBsYW4uZmFjdG9yeU5hbWV9XCJgKVxuICAgIH1cblxuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLl9ldmFsdWF0ZVNsb3Qoc2xvdCwgWy4uLnBhdGgsIG5hbWVdKVxuXG4gICAgdGhpcy5fbWVtby5zZXQobmFtZSwgcHJvbWlzZSlcbiAgICBwcm9taXNlLnRoZW4oKHZhbHVlKSA9PiB0aGlzLl9tZW1vLnNldChuYW1lLCB2YWx1ZSksICgpID0+IHt9KVxuXG4gICAgcmV0dXJuIHByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBFdmFsdWF0ZXMgYSByZXNvbHZlZCBzbG90LCBob25vdXJpbmcgbGF6eSBmdW5jdGlvbnMgYW5kIG92ZXJyaWRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2ZhY3RvcnktcnVubmVyLmpzXCIpLlNsb3R9IHNsb3QgLSBTbG90IHRvIGV2YWx1YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBjaGlsZFBhdGggLSBQYXRoIGluY2x1ZGluZyB0aGlzIHNsb3QncyBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGV2YWx1YXRlZCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIF9ldmFsdWF0ZVNsb3Qoc2xvdCwgY2hpbGRQYXRoKSB7XG4gICAgaWYgKHNsb3Quc2xvdEtpbmQgPT09IFwiYXNzb2NpYXRpb25cIikge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3Jlc29sdmVBc3NvY2lhdGlvblNsb3Qoc2xvdClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHNsb3QudmFsdWUgPT09IFwiZnVuY3Rpb25cIiAmJiAhc2xvdC5pc092ZXJyaWRlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgc2xvdC52YWx1ZSh0aGlzLmNvbnRleHRGb3IoY2hpbGRQYXRoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gc2xvdC52YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZGVjbGFyZWQvb3ZlcnJpZGRlbiBhc3NvY2lhdGlvbiBzbG90LiBBbiBleHBsaWNpdCBvYmplY3QvbnVsbFxuICAgKiBvdmVycmlkZSBzdXBwcmVzc2VzIG5lc3RlZCBmYWN0b3J5IGV4ZWN1dGlvbiBhbmQgaXMgcmV0dXJuZWQgdmVyYmF0aW0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mYWN0b3J5LXJ1bm5lci5qc1wiKS5TbG90fSBzbG90IC0gQXNzb2NpYXRpb24gc2xvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBhc3NvY2lhdGVkIHJlY29yZCAob3Igb3ZlcnJpZGUgdmFsdWUpLlxuICAgKi9cbiAgYXN5bmMgX3Jlc29sdmVBc3NvY2lhdGlvblNsb3Qoc2xvdCkge1xuICAgIGlmIChzbG90LmlzT3ZlcnJpZGUpIHJldHVybiBzbG90LnZhbHVlXG5cbiAgICBpZiAodGhpcy5zdHJhdGVneSA9PT0gXCJhdHRyaWJ1dGVzRm9yXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkZWNsYXJhdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9hc3NvY2lhdGlvbi1kZWNsYXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAqLyAoc2xvdC52YWx1ZSlcbiAgICBjb25zdCBhc3NvY2lhdGlvblN0cmF0ZWd5ID0gZGVjbGFyYXRpb24uc3RyYXRlZ3kgfHwgKHRoaXMuc3RyYXRlZ3kgPT09IFwiY3JlYXRlXCIgPyBcImJ1aWxkXCIgOiB0aGlzLnN0cmF0ZWd5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucmVnaXN0cnkuX3J1bkZhY3Rvcnkoe1xuICAgICAgZmFjdG9yeU5hbWU6IGRlY2xhcmF0aW9uLmZhY3RvcnksXG4gICAgICB0cmFpdHM6IGRlY2xhcmF0aW9uLnRyYWl0cyxcbiAgICAgIG92ZXJyaWRlczogZGVjbGFyYXRpb24ub3ZlcnJpZGVzLFxuICAgICAgc3RyYXRlZ3k6IC8qKiBAdHlwZSB7XCJidWlsZFwiIHwgXCJjcmVhdGVcIn0gKi8gKGFzc29jaWF0aW9uU3RyYXRlZ3kpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIGV4cGxpY2l0bHktaW52b2tlZCBhc3NvY2lhdGlvbiBmcm9tIGEgbGF6eSB2YWx1ZSdzIGBhc3NvY2lhdGlvbiguLi4pYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZhY3RvcnlOYW1lIC0gRmFjdG9yeSB0byBydW4uXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gVHJhaXRzIGFuZC9vciBhbiBvdmVycmlkZXMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBfcGF0aCAtIEN1cnJlbnQgcmVzb2x1dGlvbiBwYXRoICh1bnVzZWQ7IGFzc29jaWF0aW9ucyBvcGVuIGEgZnJlc2ggcnVuKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBhc3NvY2lhdGVkIHJlY29yZCwgb3IgbnVsbCB1bmRlciBhdHRyaWJ1dGVzRm9yLlxuICAgKi9cbiAgX2V4cGxpY2l0QXNzb2NpYXRpb24oZmFjdG9yeU5hbWUsIGFyZ3MsIF9wYXRoKSB7XG4gICAgaWYgKHRoaXMuc3RyYXRlZ3kgPT09IFwiYXR0cmlidXRlc0ZvclwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG51bGwpXG5cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHRyYWl0cyA9IFtdXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgbGV0IG92ZXJyaWRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGFyZyBvZiBhcmdzKSB7XG4gICAgICBpZiAodHlwZW9mIGFyZyA9PT0gXCJzdHJpbmdcIikgdHJhaXRzLnB1c2goYXJnKVxuICAgICAgZWxzZSBpZiAoYXJnICYmIHR5cGVvZiBhcmcgPT09IFwib2JqZWN0XCIpIG92ZXJyaWRlcyA9IGFyZ1xuICAgIH1cblxuICAgIGNvbnN0IGFzc29jaWF0aW9uU3RyYXRlZ3kgPSB0aGlzLnN0cmF0ZWd5ID09PSBcImNyZWF0ZVwiID8gXCJidWlsZFwiIDogdGhpcy5zdHJhdGVneVxuXG4gICAgcmV0dXJuIHRoaXMucmVnaXN0cnkuX3J1bkZhY3Rvcnkoe2ZhY3RvcnlOYW1lLCB0cmFpdHMsIG92ZXJyaWRlcywgc3RyYXRlZ3k6IGFzc29jaWF0aW9uU3RyYXRlZ3l9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGV2ZXJ5IHBsYWluIGF0dHJpYnV0ZSBzbG90ICh1c2VkIGJ5IGF0dHJpYnV0ZXNGb3IpLiBUcmFuc2llbnRzIGFuZFxuICAgKiBhc3NvY2lhdGlvbnMgYXJlIG9taXR0ZWQsIHRob3VnaCB0cmFuc2llbnRzIG1heSBzdGlsbCBiZSBldmFsdWF0ZWQgb24gZGVtYW5kXG4gICAqIGFzIGRlcGVuZGVuY2llcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgcmVzb2x2ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBdHRyaWJ1dGVzKCkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgc2xvdF0gb2YgdGhpcy5wbGFuLnJlc29sdmVkKSB7XG4gICAgICBpZiAoc2xvdC5zbG90S2luZCA9PT0gXCJhdHRyaWJ1dGVcIikge1xuICAgICAgICBhdHRyaWJ1dGVzW25hbWVdID0gYXdhaXQgdGhpcy5fZ2V0KG5hbWUsIFtdKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZXZlcnkgdHJhbnNpZW50IGJlZm9yZSBjYWxsYmFja3MgdGhhdCBleHBvc2UgdGhlbSBhcyBwbGFpbiBwcm9wZXJ0aWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEV2YWx1YXRlZCB0cmFuc2llbnQgdmFsdWVzLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZVRyYW5zaWVudHMoKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdHJhbnNpZW50cyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBzbG90XSBvZiB0aGlzLnBsYW4ucmVzb2x2ZWQpIHtcbiAgICAgIGlmIChzbG90LnNsb3RLaW5kID09PSBcInRyYW5zaWVudFwiKSB0cmFuc2llbnRzW25hbWVdID0gYXdhaXQgdGhpcy5fZ2V0KG5hbWUsIFtdKVxuICAgIH1cblxuICAgIHJldHVybiB0cmFuc2llbnRzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZXZlcnl0aGluZyBuZWVkZWQgdG8gY29uc3RydWN0IGEgcmVjb3JkOiBwdWJsaWMgYXR0cmlidXRlcyxcbiAgICogdHJhbnNpZW50cywgYW5kIGFzc29jaWF0ZWQgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3B1YmxpY0F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdHJhbnNpZW50czogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhc3NvY2lhdGlvbnM6IEFycmF5PHtuYW1lOiBzdHJpbmcsIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0+fSAtIFJlc29sdmVkIGNvbnN0cnVjdGlvbiBpbnB1dHMuXG4gICAqL1xuICBhc3luYyByZXNvbHZlRm9yQ29uc3RydWN0aW9uKCkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHB1YmxpY0F0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHRyYW5zaWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e25hbWU6IHN0cmluZywgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIGNvbnN0IGFzc29jaWF0aW9ucyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBzbG90XSBvZiB0aGlzLnBsYW4ucmVzb2x2ZWQpIHtcbiAgICAgIGlmIChzbG90LnNsb3RLaW5kID09PSBcImF0dHJpYnV0ZVwiKSB7XG4gICAgICAgIHB1YmxpY0F0dHJpYnV0ZXNbbmFtZV0gPSBhd2FpdCB0aGlzLl9nZXQobmFtZSwgW10pXG4gICAgICB9IGVsc2UgaWYgKHNsb3Quc2xvdEtpbmQgPT09IFwidHJhbnNpZW50XCIpIHtcbiAgICAgICAgdHJhbnNpZW50c1tuYW1lXSA9IGF3YWl0IHRoaXMuX2dldChuYW1lLCBbXSlcbiAgICAgIH0gZWxzZSBpZiAoc2xvdC5zbG90S2luZCA9PT0gXCJhc3NvY2lhdGlvblwiKSB7XG4gICAgICAgIGFzc29jaWF0aW9ucy5wdXNoKHtuYW1lLCByZWNvcmQ6IGF3YWl0IHRoaXMuX2dldChuYW1lLCBbXSl9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7cHVibGljQXR0cmlidXRlcywgdHJhbnNpZW50cywgYXNzb2NpYXRpb25zfVxuICB9XG59XG4iXX0=