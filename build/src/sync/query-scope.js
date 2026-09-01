// @ts-check
import stableJsonStringify from "./stable-json.js";
/**
 * Serializes a model query into a transportable sync scope.
 *
 * Only plain attribute equality conditions are supported: the scope must be
 * expressible as `{resourceType, conditions}` so servers can match it against
 * their change feeds. Anything else (raw SQL, negations, joins, orders,
 * limits, offsets, groups) fails loudly.
 * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Model query declaring the sync scope.
 * @returns {import("./sync-client-types.js").SerializedSyncScope} Serialized sync scope.
 */
export function serializedScopeFromQuery(query) {
    if (query.getJoins().length > 0)
        throw new Error("sync(query) does not support joins");
    if (query.getOrders().length > 0)
        throw new Error("sync(query) does not support orders");
    if (query.getLimit() !== null && query.getLimit() !== undefined)
        throw new Error("sync(query) does not support limit");
    if (query.getOffset() !== null && query.getOffset() !== undefined)
        throw new Error("sync(query) does not support offset");
    if (query.getGroups().length > 0)
        throw new Error("sync(query) does not support groups");
    const modelClass = query.getModelClass();
    const conditions = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({});
    for (const where of query.getWheres()) {
        const whereHash = /** @type {{hash?: Record<string, ReturnType<typeof JSON.parse>>}} */ (where).hash;
        if (!whereHash || typeof whereHash !== "object" || Array.isArray(whereHash) || /** @type {{where?: ReturnType<typeof JSON.parse>}} */ (where).where) {
            throw new Error(`sync(query) only supports plain attribute conditions, got: ${where.constructor.name}`);
        }
        for (const [attributeName, value] of Object.entries(whereHash)) {
            const conditionValue = scalarConditionValue(attributeName, value);
            if (attributeName in conditions && stableJsonStringify(conditions[attributeName]) !== stableJsonStringify(conditionValue)) {
                throw new Error(`sync(query) got conflicting conditions for: ${attributeName}`);
            }
            conditions[attributeName] = conditionValue;
        }
    }
    return { conditions, resourceType: modelClass.getModelName() };
}
/**
 * Returns a stable canonical key identifying a sync scope. When an `owner` is
 * present (the authenticated identity that declared the scope locally), it
 * participates in the key so the same wire scope owned by a different user gets
 * its own local identity and cursor — a user scope's empty-conditions cursor
 * never leaks across accounts on a shared device, while the same user
 * reconnecting keeps continuity. Owner-less scopes keep their pre-owner key.
 *
 * A null `resourceType` is the all-types scope (the user scope): one scope
 * covering every resource type the server authorizes for the caller, rather
 * than one scope per type. It keys as an empty resource type, so it never
 * collides with a type-declared scope.
 * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
 * @returns {string} Stable scope key.
 */
export function scopeKey(scope) {
    const ownerPrefix = scope.owner === undefined || scope.owner === null ? "" : `owner=${stableJsonStringify(scope.owner)}|`;
    return `${ownerPrefix}${scope.resourceType ?? ""}:${stableJsonStringify(scope.conditions)}`;
}
/**
 * Validates one scope condition value as a scalar or array of scalars.
 * @param {string} attributeName - Condition attribute name for error messages.
 * @param {ReturnType<typeof JSON.parse>} value - Condition value.
 * @returns {ReturnType<typeof JSON.parse>} Validated condition value.
 */
function scalarConditionValue(attributeName, value) {
    if (Array.isArray(value)) {
        for (const item of value)
            validateScalar(attributeName, item);
        return value;
    }
    validateScalar(attributeName, value);
    return value;
}
/**
 * Validates one scalar condition value.
 * @param {string} attributeName - Condition attribute name for error messages.
 * @param {ReturnType<typeof JSON.parse>} value - Condition value.
 * @returns {void}
 */
function validateScalar(attributeName, value) {
    if (value === null)
        return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return;
    throw new Error(`sync(query) condition values must be scalar, got ${typeof value} for: ${attributeName}`);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktc2NvcGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9xdWVyeS1zY29wZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxtQkFBbUIsTUFBTSxrQkFBa0IsQ0FBQTtBQUVsRDs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLFVBQVUsd0JBQXdCLENBQUMsS0FBSztJQUM1QyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtJQUN0RixJQUFJLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQTtJQUN4RixJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLFFBQVEsRUFBRSxLQUFLLFNBQVM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUE7SUFDdEgsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLEtBQUssSUFBSSxJQUFJLEtBQUssQ0FBQyxTQUFTLEVBQUUsS0FBSyxTQUFTO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFBO0lBQ3pILElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFBO0lBRXhGLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQTtJQUN4QyxNQUFNLFVBQVUsR0FBRyw0REFBNEQsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBRXBGLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUM7UUFDdEMsTUFBTSxTQUFTLEdBQUcscUVBQXFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFFcEcsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsSUFBSSxzREFBc0QsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3BKLE1BQU0sSUFBSSxLQUFLLENBQUMsOERBQThELEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUN6RyxDQUFDO1FBRUQsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUMvRCxNQUFNLGNBQWMsR0FBRyxvQkFBb0IsQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFFakUsSUFBSSxhQUFhLElBQUksVUFBVSxJQUFJLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQyxLQUFLLG1CQUFtQixDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7Z0JBQzFILE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLGFBQWEsRUFBRSxDQUFDLENBQUE7WUFDakYsQ0FBQztZQUVELFVBQVUsQ0FBQyxhQUFhLENBQUMsR0FBRyxjQUFjLENBQUE7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEVBQUMsVUFBVSxFQUFFLFlBQVksRUFBRSxVQUFVLENBQUMsWUFBWSxFQUFFLEVBQUMsQ0FBQTtBQUM5RCxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7O0dBY0c7QUFDSCxNQUFNLFVBQVUsUUFBUSxDQUFDLEtBQUs7SUFDNUIsTUFBTSxXQUFXLEdBQUcsS0FBSyxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQTtJQUV6SCxPQUFPLEdBQUcsV0FBVyxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksRUFBRSxJQUFJLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFBO0FBQzdGLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsb0JBQW9CLENBQUMsYUFBYSxFQUFFLEtBQUs7SUFDaEQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDekIsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLO1lBQUUsY0FBYyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUU3RCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRCxjQUFjLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBRXBDLE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxjQUFjLENBQUMsYUFBYSxFQUFFLEtBQUs7SUFDMUMsSUFBSSxLQUFLLEtBQUssSUFBSTtRQUFFLE9BQU07SUFDMUIsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLFNBQVM7UUFBRSxPQUFNO0lBRWhHLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELE9BQU8sS0FBSyxTQUFTLGFBQWEsRUFBRSxDQUFDLENBQUE7QUFDM0csQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi9zdGFibGUtanNvbi5qc1wiXG5cbi8qKlxuICogU2VyaWFsaXplcyBhIG1vZGVsIHF1ZXJ5IGludG8gYSB0cmFuc3BvcnRhYmxlIHN5bmMgc2NvcGUuXG4gKlxuICogT25seSBwbGFpbiBhdHRyaWJ1dGUgZXF1YWxpdHkgY29uZGl0aW9ucyBhcmUgc3VwcG9ydGVkOiB0aGUgc2NvcGUgbXVzdCBiZVxuICogZXhwcmVzc2libGUgYXMgYHtyZXNvdXJjZVR5cGUsIGNvbmRpdGlvbnN9YCBzbyBzZXJ2ZXJzIGNhbiBtYXRjaCBpdCBhZ2FpbnN0XG4gKiB0aGVpciBjaGFuZ2UgZmVlZHMuIEFueXRoaW5nIGVsc2UgKHJhdyBTUUwsIG5lZ2F0aW9ucywgam9pbnMsIG9yZGVycyxcbiAqIGxpbWl0cywgb2Zmc2V0cywgZ3JvdXBzKSBmYWlscyBsb3VkbHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBxdWVyeSAtIE1vZGVsIHF1ZXJ5IGRlY2xhcmluZyB0aGUgc3luYyBzY29wZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGV9IFNlcmlhbGl6ZWQgc3luYyBzY29wZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZWRTY29wZUZyb21RdWVyeShxdWVyeSkge1xuICBpZiAocXVlcnkuZ2V0Sm9pbnMoKS5sZW5ndGggPiAwKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jKHF1ZXJ5KSBkb2VzIG5vdCBzdXBwb3J0IGpvaW5zXCIpXG4gIGlmIChxdWVyeS5nZXRPcmRlcnMoKS5sZW5ndGggPiAwKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jKHF1ZXJ5KSBkb2VzIG5vdCBzdXBwb3J0IG9yZGVyc1wiKVxuICBpZiAocXVlcnkuZ2V0TGltaXQoKSAhPT0gbnVsbCAmJiBxdWVyeS5nZXRMaW1pdCgpICE9PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcInN5bmMocXVlcnkpIGRvZXMgbm90IHN1cHBvcnQgbGltaXRcIilcbiAgaWYgKHF1ZXJ5LmdldE9mZnNldCgpICE9PSBudWxsICYmIHF1ZXJ5LmdldE9mZnNldCgpICE9PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcInN5bmMocXVlcnkpIGRvZXMgbm90IHN1cHBvcnQgb2Zmc2V0XCIpXG4gIGlmIChxdWVyeS5nZXRHcm91cHMoKS5sZW5ndGggPiAwKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jKHF1ZXJ5KSBkb2VzIG5vdCBzdXBwb3J0IGdyb3Vwc1wiKVxuXG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSBxdWVyeS5nZXRNb2RlbENsYXNzKClcbiAgY29uc3QgY29uZGl0aW9ucyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe30pXG5cbiAgZm9yIChjb25zdCB3aGVyZSBvZiBxdWVyeS5nZXRXaGVyZXMoKSkge1xuICAgIGNvbnN0IHdoZXJlSGFzaCA9IC8qKiBAdHlwZSB7e2hhc2g/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqLyAod2hlcmUpLmhhc2hcblxuICAgIGlmICghd2hlcmVIYXNoIHx8IHR5cGVvZiB3aGVyZUhhc2ggIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh3aGVyZUhhc2gpIHx8IC8qKiBAdHlwZSB7e3doZXJlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAod2hlcmUpLndoZXJlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN5bmMocXVlcnkpIG9ubHkgc3VwcG9ydHMgcGxhaW4gYXR0cmlidXRlIGNvbmRpdGlvbnMsIGdvdDogJHt3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHdoZXJlSGFzaCkpIHtcbiAgICAgIGNvbnN0IGNvbmRpdGlvblZhbHVlID0gc2NhbGFyQ29uZGl0aW9uVmFsdWUoYXR0cmlidXRlTmFtZSwgdmFsdWUpXG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lIGluIGNvbmRpdGlvbnMgJiYgc3RhYmxlSnNvblN0cmluZ2lmeShjb25kaXRpb25zW2F0dHJpYnV0ZU5hbWVdKSAhPT0gc3RhYmxlSnNvblN0cmluZ2lmeShjb25kaXRpb25WYWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBzeW5jKHF1ZXJ5KSBnb3QgY29uZmxpY3RpbmcgY29uZGl0aW9ucyBmb3I6ICR7YXR0cmlidXRlTmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25kaXRpb25zW2F0dHJpYnV0ZU5hbWVdID0gY29uZGl0aW9uVmFsdWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2NvbmRpdGlvbnMsIHJlc291cmNlVHlwZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgc3RhYmxlIGNhbm9uaWNhbCBrZXkgaWRlbnRpZnlpbmcgYSBzeW5jIHNjb3BlLiBXaGVuIGFuIGBvd25lcmAgaXNcbiAqIHByZXNlbnQgKHRoZSBhdXRoZW50aWNhdGVkIGlkZW50aXR5IHRoYXQgZGVjbGFyZWQgdGhlIHNjb3BlIGxvY2FsbHkpLCBpdFxuICogcGFydGljaXBhdGVzIGluIHRoZSBrZXkgc28gdGhlIHNhbWUgd2lyZSBzY29wZSBvd25lZCBieSBhIGRpZmZlcmVudCB1c2VyIGdldHNcbiAqIGl0cyBvd24gbG9jYWwgaWRlbnRpdHkgYW5kIGN1cnNvciDigJQgYSB1c2VyIHNjb3BlJ3MgZW1wdHktY29uZGl0aW9ucyBjdXJzb3JcbiAqIG5ldmVyIGxlYWtzIGFjcm9zcyBhY2NvdW50cyBvbiBhIHNoYXJlZCBkZXZpY2UsIHdoaWxlIHRoZSBzYW1lIHVzZXJcbiAqIHJlY29ubmVjdGluZyBrZWVwcyBjb250aW51aXR5LiBPd25lci1sZXNzIHNjb3BlcyBrZWVwIHRoZWlyIHByZS1vd25lciBrZXkuXG4gKlxuICogQSBudWxsIGByZXNvdXJjZVR5cGVgIGlzIHRoZSBhbGwtdHlwZXMgc2NvcGUgKHRoZSB1c2VyIHNjb3BlKTogb25lIHNjb3BlXG4gKiBjb3ZlcmluZyBldmVyeSByZXNvdXJjZSB0eXBlIHRoZSBzZXJ2ZXIgYXV0aG9yaXplcyBmb3IgdGhlIGNhbGxlciwgcmF0aGVyXG4gKiB0aGFuIG9uZSBzY29wZSBwZXIgdHlwZS4gSXQga2V5cyBhcyBhbiBlbXB0eSByZXNvdXJjZSB0eXBlLCBzbyBpdCBuZXZlclxuICogY29sbGlkZXMgd2l0aCBhIHR5cGUtZGVjbGFyZWQgc2NvcGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZX0gc2NvcGUgLSBTZXJpYWxpemVkIHN5bmMgc2NvcGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBTdGFibGUgc2NvcGUga2V5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2NvcGVLZXkoc2NvcGUpIHtcbiAgY29uc3Qgb3duZXJQcmVmaXggPSBzY29wZS5vd25lciA9PT0gdW5kZWZpbmVkIHx8IHNjb3BlLm93bmVyID09PSBudWxsID8gXCJcIiA6IGBvd25lcj0ke3N0YWJsZUpzb25TdHJpbmdpZnkoc2NvcGUub3duZXIpfXxgXG5cbiAgcmV0dXJuIGAke293bmVyUHJlZml4fSR7c2NvcGUucmVzb3VyY2VUeXBlID8/IFwiXCJ9OiR7c3RhYmxlSnNvblN0cmluZ2lmeShzY29wZS5jb25kaXRpb25zKX1gXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIG9uZSBzY29wZSBjb25kaXRpb24gdmFsdWUgYXMgYSBzY2FsYXIgb3IgYXJyYXkgb2Ygc2NhbGFycy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQ29uZGl0aW9uIGF0dHJpYnV0ZSBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZGl0aW9uIHZhbHVlLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBWYWxpZGF0ZWQgY29uZGl0aW9uIHZhbHVlLlxuICovXG5mdW5jdGlvbiBzY2FsYXJDb25kaXRpb25WYWx1ZShhdHRyaWJ1dGVOYW1lLCB2YWx1ZSkge1xuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdmFsdWUpIHZhbGlkYXRlU2NhbGFyKGF0dHJpYnV0ZU5hbWUsIGl0ZW0pXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIHZhbGlkYXRlU2NhbGFyKGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgc2NhbGFyIGNvbmRpdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQ29uZGl0aW9uIGF0dHJpYnV0ZSBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZGl0aW9uIHZhbHVlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlU2NhbGFyKGF0dHJpYnV0ZU5hbWUsIHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHJldHVyblxuXG4gIHRocm93IG5ldyBFcnJvcihgc3luYyhxdWVyeSkgY29uZGl0aW9uIHZhbHVlcyBtdXN0IGJlIHNjYWxhciwgZ290ICR7dHlwZW9mIHZhbHVlfSBmb3I6ICR7YXR0cmlidXRlTmFtZX1gKVxufVxuIl19