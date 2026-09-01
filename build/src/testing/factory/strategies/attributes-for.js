// @ts-check
import BaseStrategy from "./base.js";
/**
 * The `attributesFor` strategy. It resolves scalar/lazy attributes (and any
 * transients they depend on) but never initializes the model, runs lifecycle
 * callbacks, or evaluates/builds declared associations. Transients and
 * associations are omitted from the returned plain object.
 */
export default class AttributesForStrategy extends BaseStrategy {
    /**
     * Runs the strategy.
     * @param {object} args - Options.
     * @param {import("../factory-registry.js").default} args.registry - Owning registry.
     * @param {import("../factory-runner.js").CompiledPlan} args.plan - Compiled plan.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - The resolved attributes.
     */
    async run({ registry, plan }) {
        const context = this._newContext(registry, plan, "attributesFor");
        return await context.resolveAttributes();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0cmlidXRlcy1mb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9mYWN0b3J5L3N0cmF0ZWdpZXMvYXR0cmlidXRlcy1mb3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLFdBQVcsQ0FBQTtBQUVwQzs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8scUJBQXNCLFNBQVEsWUFBWTtJQUM3RDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksRUFBQztRQUN4QixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsZUFBZSxDQUFDLENBQUE7UUFFakUsT0FBTyxNQUFNLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFzZVN0cmF0ZWd5IGZyb20gXCIuL2Jhc2UuanNcIlxuXG4vKipcbiAqIFRoZSBgYXR0cmlidXRlc0ZvcmAgc3RyYXRlZ3kuIEl0IHJlc29sdmVzIHNjYWxhci9sYXp5IGF0dHJpYnV0ZXMgKGFuZCBhbnlcbiAqIHRyYW5zaWVudHMgdGhleSBkZXBlbmQgb24pIGJ1dCBuZXZlciBpbml0aWFsaXplcyB0aGUgbW9kZWwsIHJ1bnMgbGlmZWN5Y2xlXG4gKiBjYWxsYmFja3MsIG9yIGV2YWx1YXRlcy9idWlsZHMgZGVjbGFyZWQgYXNzb2NpYXRpb25zLiBUcmFuc2llbnRzIGFuZFxuICogYXNzb2NpYXRpb25zIGFyZSBvbWl0dGVkIGZyb20gdGhlIHJldHVybmVkIHBsYWluIG9iamVjdC5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQXR0cmlidXRlc0ZvclN0cmF0ZWd5IGV4dGVuZHMgQmFzZVN0cmF0ZWd5IHtcbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHN0cmF0ZWd5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZmFjdG9yeS1yZWdpc3RyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlZ2lzdHJ5IC0gT3duaW5nIHJlZ2lzdHJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2ZhY3RvcnktcnVubmVyLmpzXCIpLkNvbXBpbGVkUGxhbn0gYXJncy5wbGFuIC0gQ29tcGlsZWQgcGxhbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgcmVzb2x2ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIGFzeW5jIHJ1bih7cmVnaXN0cnksIHBsYW59KSB7XG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuX25ld0NvbnRleHQocmVnaXN0cnksIHBsYW4sIFwiYXR0cmlidXRlc0ZvclwiKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbnRleHQucmVzb2x2ZUF0dHJpYnV0ZXMoKVxuICB9XG59XG4iXX0=