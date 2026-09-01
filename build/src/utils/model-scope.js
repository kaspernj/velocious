/**
 * ModelScopeDescriptor type.
 * @typedef {object} ModelScopeDescriptor
 * @property {true} [velociousModelScopeDescriptor] - Internal marker.
 * @property {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
 * @property {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} modelClass - Owning model class.
 * @property {Array<ReturnType<typeof JSON.parse>>} scopeArgs - Scope arguments.
 */
// @ts-check
const MODEL_SCOPE_DESCRIPTOR_MARKER = "velociousModelScopeDescriptor";
/**
 * Runs the defineModelScope helper.
 * @param {object} args - Definition arguments.
 * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} args.callback - Scope callback.
 * @param {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} args.modelClass - Owning model class.
 * @param {(modelClass?: typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass) => ReturnType<typeof JSON.parse>} args.startQuery - Factory that returns a fresh query for the invoked model class.
 * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => ModelScopeDescriptor}} - Scope helper.
 */
export function defineModelScope({ callback, modelClass, startQuery }) {
    /**
     * Runs defined scope.
     * @this {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass | undefined}
     * @param {...ReturnType<typeof JSON.parse>} scopeArgs - Scope arguments.
     * @returns {ReturnType<typeof JSON.parse>} - Scoped root query.
     */
    function definedScope(...scopeArgs) {
        const invokedModelClass = typeof this === "function" ? this : modelClass;
        return startQuery(invokedModelClass).scope(definedScope.scope(...scopeArgs));
    }
    /**
     * Builds a reusable scope descriptor.
     * @param {...ReturnType<typeof JSON.parse>} scopeArgs - Scope arguments.
     * @returns {ModelScopeDescriptor} - Reusable scope descriptor.
     */
    definedScope.scope = (...scopeArgs) => ({
        [MODEL_SCOPE_DESCRIPTOR_MARKER]: true,
        callback,
        modelClass,
        scopeArgs
    });
    return definedScope;
}
/**
 * Runs the isModelScopeDescriptor helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate descriptor.
 * @returns {value is ModelScopeDescriptor} - Whether the value is a scope descriptor.
 */
export function isModelScopeDescriptor(value) {
    return Boolean(value && typeof value === "object" && /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)[MODEL_SCOPE_DESCRIPTOR_MARKER] === true);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwtc2NvcGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvbW9kZWwtc2NvcGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7R0FPRztBQUNILFlBQVk7QUFFWixNQUFNLDZCQUE2QixHQUFHLCtCQUErQixDQUFBO0FBRXJFOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLFVBQVUsZ0JBQWdCLENBQUMsRUFBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBQztJQUNqRTs7Ozs7T0FLRztJQUNILFNBQVMsWUFBWSxDQUFDLEdBQUcsU0FBUztRQUNoQyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sSUFBSSxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUE7UUFFeEUsT0FBTyxVQUFVLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUE7SUFDOUUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsS0FBSyxHQUFHLENBQUMsR0FBRyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDdEMsQ0FBQyw2QkFBNkIsQ0FBQyxFQUFFLElBQUk7UUFDckMsUUFBUTtRQUNSLFVBQVU7UUFDVixTQUFTO0tBQ1YsQ0FBQyxDQUFBO0lBRUYsT0FBTyxZQUFZLENBQUE7QUFDckIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUsc0JBQXNCLENBQUMsS0FBSztJQUMxQyxPQUFPLE9BQU8sQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLDREQUE0RCxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsNkJBQTZCLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQTtBQUNwSyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBNb2RlbFNjb3BlRGVzY3JpcHRvciB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gTW9kZWxTY29wZURlc2NyaXB0b3JcbiAqIEBwcm9wZXJ0eSB7dHJ1ZX0gW3ZlbG9jaW91c01vZGVsU2NvcGVEZXNjcmlwdG9yXSAtIEludGVybmFsIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7KC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNhbGxiYWNrIC0gU2NvcGUgY2FsbGJhY2suXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE93bmluZyBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBzY29wZUFyZ3MgLSBTY29wZSBhcmd1bWVudHMuXG4gKi9cbi8vIEB0cy1jaGVja1xuXG5jb25zdCBNT0RFTF9TQ09QRV9ERVNDUklQVE9SX01BUktFUiA9IFwidmVsb2Npb3VzTW9kZWxTY29wZURlc2NyaXB0b3JcIlxuXG4vKipcbiAqIFJ1bnMgdGhlIGRlZmluZU1vZGVsU2NvcGUgaGVscGVyLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBEZWZpbml0aW9uIGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7KC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBhcmdzLm1vZGVsQ2xhc3MgLSBPd25pbmcgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0geyhtb2RlbENsYXNzPzogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zdGFydFF1ZXJ5IC0gRmFjdG9yeSB0aGF0IHJldHVybnMgYSBmcmVzaCBxdWVyeSBmb3IgdGhlIGludm9rZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSAmIHtzY29wZTogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gTW9kZWxTY29wZURlc2NyaXB0b3J9fSAtIFNjb3BlIGhlbHBlci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmluZU1vZGVsU2NvcGUoe2NhbGxiYWNrLCBtb2RlbENsYXNzLCBzdGFydFF1ZXJ5fSkge1xuICAvKipcbiAgICogUnVucyBkZWZpbmVkIHNjb3BlLlxuICAgKiBAdGhpcyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzIHwgdW5kZWZpbmVkfVxuICAgKiBAcGFyYW0gey4uLlJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzY29wZUFyZ3MgLSBTY29wZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTY29wZWQgcm9vdCBxdWVyeS5cbiAgICovXG4gIGZ1bmN0aW9uIGRlZmluZWRTY29wZSguLi5zY29wZUFyZ3MpIHtcbiAgICBjb25zdCBpbnZva2VkTW9kZWxDbGFzcyA9IHR5cGVvZiB0aGlzID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzIDogbW9kZWxDbGFzc1xuXG4gICAgcmV0dXJuIHN0YXJ0UXVlcnkoaW52b2tlZE1vZGVsQ2xhc3MpLnNjb3BlKGRlZmluZWRTY29wZS5zY29wZSguLi5zY29wZUFyZ3MpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJldXNhYmxlIHNjb3BlIGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7Li4uUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNjb3BlQXJncyAtIFNjb3BlIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge01vZGVsU2NvcGVEZXNjcmlwdG9yfSAtIFJldXNhYmxlIHNjb3BlIGRlc2NyaXB0b3IuXG4gICAqL1xuICBkZWZpbmVkU2NvcGUuc2NvcGUgPSAoLi4uc2NvcGVBcmdzKSA9PiAoe1xuICAgIFtNT0RFTF9TQ09QRV9ERVNDUklQVE9SX01BUktFUl06IHRydWUsXG4gICAgY2FsbGJhY2ssXG4gICAgbW9kZWxDbGFzcyxcbiAgICBzY29wZUFyZ3NcbiAgfSlcblxuICByZXR1cm4gZGVmaW5lZFNjb3BlXG59XG5cbi8qKlxuICogUnVucyB0aGUgaXNNb2RlbFNjb3BlRGVzY3JpcHRvciBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBkZXNjcmlwdG9yLlxuICogQHJldHVybnMge3ZhbHVlIGlzIE1vZGVsU2NvcGVEZXNjcmlwdG9yfSAtIFdoZXRoZXIgdGhlIHZhbHVlIGlzIGEgc2NvcGUgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTW9kZWxTY29wZURlc2NyaXB0b3IodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpW01PREVMX1NDT1BFX0RFU0NSSVBUT1JfTUFSS0VSXSA9PT0gdHJ1ZSlcbn1cbiJdfQ==