// @ts-check
import { optionalFloat, optionalInteger, optionalString } from "typanic";
import SyncApiClient from "./sync-api-client.js";
/**
 * Coercers for the declarative sync field types. All are present-key based:
 * a field is only applied when its key exists in the mutation data.
 * @type {Record<string, (value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>>}
 */
const FIELD_TYPES = {
    booleanOrNull: (value, label) => SyncApiClient.optionalBooleanSyncValue(value, label),
    dateOrNull: (value, label) => optionalSyncDate(value, label),
    floatOrNull: (value, label) => optionalFloat(value, label),
    integerOrNull: (value, label) => optionalInteger(value, label),
    raw: (value) => value,
    stringOrNull: (value, label) => optionalString(value, label)
};
/**
 * Parses an optional date value, failing loudly on invalid input.
 * @param {ReturnType<typeof JSON.parse>} value - Date, parseable string, or epoch number.
 * @param {string} label - Field label for error messages.
 * @returns {Date | null} Parsed date or null when absent.
 */
function optionalSyncDate(value, label) {
    if (value === null || value === undefined)
        return null;
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value;
    if (typeof value === "string" || typeof value === "number") {
        const dateValue = new Date(value);
        if (!Number.isNaN(dateValue.getTime()))
            return dateValue;
    }
    throw new Error(`Expected ${label} to be a valid date or null`);
}
/**
 * Declarative field-map upsert applier for sync replay mutations.
 *
 * Owns the generic mechanics every per-resource replay handler repeats:
 * present-key filtering, per-field type coercion, unknown-key rejection, the
 * find-or-create upsert, the delete branch, optional snapshot serialization,
 * and the domain after-apply tail. Apps declare only the field map and hooks.
 * @deprecated Prefer resource-routed replay (`SyncEnvelopeReplayService` with `configuration`/`resourceTypeOverrides` and resource `writableAttributes` permit lists) — value casting and validation belong to the record layer. This applier remains for released applyHandlers adopters and will be removed after their migration.
 */
export default class SyncReplayUpsertApplier {
    /**
     * Creates a declarative upsert applier.
     * @param {object} args - Applier configuration.
     * @param {ReturnType<typeof JSON.parse>} args.modelClass - Model class receiving the mutations.
     * @param {Record<string, string | {type: string, column?: string} | ((value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>)>} args.fields - Data-key → field-type map: a named type, a {type, column} rename spec, "ignored" for accepted-but-dropped keys, or a custom coercer function.
     * @param {(args: {data: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<ReturnType<typeof JSON.parse>>} [args.findRecord] - Custom record resolver. Defaults to findBy({id: mutation.resourceId}).
     * @param {(args: {mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<ReturnType<typeof JSON.parse>>} [args.findRecordForDelete] - Custom delete resolver. Defaults to findRecord.
     * @param {"error" | "ignore"} [args.restArgs] - Unknown data-key handling. Defaults to "error".
     * @param {(args: {mappedAttributes: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, record: ReturnType<typeof JSON.parse>}) => Promise<Record<string, ReturnType<typeof JSON.parse>> | void>} [args.afterApply] - Domain tail; its returned object merges into the apply result.
     * @param {(args: {mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, record: ReturnType<typeof JSON.parse>}) => Promise<Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>} [args.serialize] - Snapshot serializer; result lands on applyResult.serializedData.
     */
    constructor({ afterApply, fields, findRecord, findRecordForDelete, modelClass, restArgs = "error", serialize }) {
        if (!modelClass)
            throw new Error("SyncReplayUpsertApplier requires a modelClass");
        if (!fields || typeof fields !== "object")
            throw new Error("SyncReplayUpsertApplier requires a fields map");
        if (restArgs !== "error" && restArgs !== "ignore") {
            throw new Error(`SyncReplayUpsertApplier restArgs must be "error" or "ignore", got: ${String(restArgs)}`);
        }
        for (const [fieldName, fieldSpec] of Object.entries(fields)) {
            if (typeof fieldSpec === "function")
                continue;
            const fieldType = typeof fieldSpec === "string" ? fieldSpec : fieldSpec.type;
            if (fieldType !== "ignored" && !(fieldType in FIELD_TYPES)) {
                throw new Error(`Unknown sync field type: ${fieldType} for: ${fieldName}`);
            }
        }
        this.afterApply = afterApply;
        this.fields = fields;
        this.findRecord = findRecord;
        this.findRecordForDelete = findRecordForDelete;
        this.modelClass = modelClass;
        this.restArgs = restArgs;
        this.serialize = serialize;
    }
    /**
     * Applies one normalized replay mutation to the declared model.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: ReturnType<typeof JSON.parse>}} args - Replay apply arguments.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the record, created/deleted flags, optional serializedData, and afterApply extras.
     */
    async apply({ context, mutation }) {
        if (mutation.syncType === "delete")
            return await this.applyDelete({ context, mutation });
        const mappedAttributes = this.mappedAttributes(mutation.data);
        const record = this.findRecord
            ? await this.findRecord({ context, data: mutation.data, mutation })
            : await this.modelClass.findBy({ id: mutation.resourceId });
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const result = { created: false, deleted: false, record: null };
        if (record) {
            record.assign(mappedAttributes);
            await record.save();
            result.record = record;
        }
        else {
            result.record = await this.modelClass.create({ id: mutation.resourceId, ...mappedAttributes });
            result.created = true;
        }
        if (this.serialize)
            result.serializedData = await this.serialize({ context, mutation, record: result.record });
        if (this.afterApply) {
            const afterApplyResult = await this.afterApply({ context, mappedAttributes, mutation, record: result.record });
            if (afterApplyResult && typeof afterApplyResult === "object")
                Object.assign(result, afterApplyResult);
        }
        return result;
    }
    /**
     * Applies a delete mutation to the declared model.
     * @param {{context: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>}} args - Delete arguments.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the deleted flag.
     */
    async applyDelete({ context, mutation }) {
        const resolveRecord = this.findRecordForDelete || this.findRecord;
        const record = resolveRecord
            ? await resolveRecord({ context, data: mutation.data, mutation })
            : await this.modelClass.findBy({ id: mutation.resourceId });
        if (!record)
            return { created: false, deleted: false, record: null };
        await record.destroy();
        return { created: false, deleted: true, record };
    }
    /**
     * Maps present data keys through the declared field types.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Normalized mutation data.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Coerced attributes keyed by column name.
     */
    mappedAttributes(data) {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const mappedAttributes = {};
        /** @type {string[]} */
        const unknownKeys = [];
        for (const [dataKey, value] of Object.entries(data)) {
            const fieldSpec = this.fields[dataKey];
            if (!fieldSpec) {
                unknownKeys.push(dataKey);
                continue;
            }
            if (typeof fieldSpec === "function") {
                mappedAttributes[dataKey] = fieldSpec(value, dataKey);
                continue;
            }
            const fieldType = typeof fieldSpec === "string" ? fieldSpec : fieldSpec.type;
            if (fieldType === "ignored")
                continue;
            const column = typeof fieldSpec === "string" ? dataKey : fieldSpec.column || dataKey;
            mappedAttributes[column] = FIELD_TYPES[fieldType](value, dataKey);
        }
        if (unknownKeys.length > 0 && this.restArgs === "error") {
            throw new Error(`Unknown sync data keys: ${unknownKeys.join(", ")}`);
        }
        return mappedAttributes;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZXBsYXktdXBzZXJ0LWFwcGxpZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLXJlcGxheS11cHNlcnQtYXBwbGllci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLGFBQWEsRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFDLE1BQU0sU0FBUyxDQUFBO0FBRXRFLE9BQU8sYUFBYSxNQUFNLHNCQUFzQixDQUFBO0FBRWhEOzs7O0dBSUc7QUFDSCxNQUFNLFdBQVcsR0FBRztJQUNsQixhQUFhLEVBQUUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQztJQUNyRixVQUFVLEVBQUUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDO0lBQzVELFdBQVcsRUFBRSxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDO0lBQzFELGFBQWEsRUFBRSxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLGVBQWUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDO0lBQzlELEdBQUcsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSztJQUNyQixZQUFZLEVBQUUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxjQUFjLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQztDQUM3RCxDQUFBO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQUssRUFBRSxLQUFLO0lBQ3BDLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUssU0FBUztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBRXRELElBQUksS0FBSyxZ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QUFNLENBQUMsT0FBTyxDQUFDLENBQUE7WUFFdEMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO2dCQUNmLFdBQVcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7Z0JBQ3pCLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxPQUFPLFNBQVMsS0FBSyxVQUFVLEVBQUUsQ0FBQztnQkFDcEMsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLEdBQUcsU0FBUyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQTtnQkFDckQsU0FBUTtZQUNWLENBQUM7WUFFRCxNQUFNLFNBQVMsR0FBRyxPQUFPLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQTtZQUU1RSxJQUFJLFNBQVMsS0FBSyxTQUFTO2dCQUFFLFNBQVE7WUFFckMsTUFBTSxNQUFNLEdBQUcsT0FBTyxTQUFTLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFBO1lBRXBGLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxHQUFHLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDbkUsQ0FBQztRQUVELElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLFFBQVEsS0FBSyxPQUFPLEVBQUUsQ0FBQztZQUN4RCxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN0RSxDQUFDO1FBRUQsT0FBTyxnQkFBZ0IsQ0FBQTtJQUN6QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtvcHRpb25hbEZsb2F0LCBvcHRpb25hbEludGVnZXIsIG9wdGlvbmFsU3RyaW5nfSBmcm9tIFwidHlwYW5pY1wiXG5cbmltcG9ydCBTeW5jQXBpQ2xpZW50IGZyb20gXCIuL3N5bmMtYXBpLWNsaWVudC5qc1wiXG5cbi8qKlxuICogQ29lcmNlcnMgZm9yIHRoZSBkZWNsYXJhdGl2ZSBzeW5jIGZpZWxkIHR5cGVzLiBBbGwgYXJlIHByZXNlbnQta2V5IGJhc2VkOlxuICogYSBmaWVsZCBpcyBvbmx5IGFwcGxpZWQgd2hlbiBpdHMga2V5IGV4aXN0cyBpbiB0aGUgbXV0YXRpb24gZGF0YS5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAodmFsdWU6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBsYWJlbDogc3RyaW5nKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59XG4gKi9cbmNvbnN0IEZJRUxEX1RZUEVTID0ge1xuICBib29sZWFuT3JOdWxsOiAodmFsdWUsIGxhYmVsKSA9PiBTeW5jQXBpQ2xpZW50Lm9wdGlvbmFsQm9vbGVhblN5bmNWYWx1ZSh2YWx1ZSwgbGFiZWwpLFxuICBkYXRlT3JOdWxsOiAodmFsdWUsIGxhYmVsKSA9PiBvcHRpb25hbFN5bmNEYXRlKHZhbHVlLCBsYWJlbCksXG4gIGZsb2F0T3JOdWxsOiAodmFsdWUsIGxhYmVsKSA9PiBvcHRpb25hbEZsb2F0KHZhbHVlLCBsYWJlbCksXG4gIGludGVnZXJPck51bGw6ICh2YWx1ZSwgbGFiZWwpID0+IG9wdGlvbmFsSW50ZWdlcih2YWx1ZSwgbGFiZWwpLFxuICByYXc6ICh2YWx1ZSkgPT4gdmFsdWUsXG4gIHN0cmluZ09yTnVsbDogKHZhbHVlLCBsYWJlbCkgPT4gb3B0aW9uYWxTdHJpbmcodmFsdWUsIGxhYmVsKVxufVxuXG4vKipcbiAqIFBhcnNlcyBhbiBvcHRpb25hbCBkYXRlIHZhbHVlLCBmYWlsaW5nIGxvdWRseSBvbiBpbnZhbGlkIGlucHV0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBEYXRlLCBwYXJzZWFibGUgc3RyaW5nLCBvciBlcG9jaCBudW1iZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBGaWVsZCBsYWJlbCBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gKiBAcmV0dXJucyB7RGF0ZSB8IG51bGx9IFBhcnNlZCBkYXRlIG9yIG51bGwgd2hlbiBhYnNlbnQuXG4gKi9cbmZ1bmN0aW9uIG9wdGlvbmFsU3luY0RhdGUodmFsdWUsIGxhYmVsKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgIU51bWJlci5pc05hTih2YWx1ZS5nZXRUaW1lKCkpKSByZXR1cm4gdmFsdWVcblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgIGNvbnN0IGRhdGVWYWx1ZSA9IG5ldyBEYXRlKHZhbHVlKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNOYU4oZGF0ZVZhbHVlLmdldFRpbWUoKSkpIHJldHVybiBkYXRlVmFsdWVcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHtsYWJlbH0gdG8gYmUgYSB2YWxpZCBkYXRlIG9yIG51bGxgKVxufVxuXG4vKipcbiAqIERlY2xhcmF0aXZlIGZpZWxkLW1hcCB1cHNlcnQgYXBwbGllciBmb3Igc3luYyByZXBsYXkgbXV0YXRpb25zLlxuICpcbiAqIE93bnMgdGhlIGdlbmVyaWMgbWVjaGFuaWNzIGV2ZXJ5IHBlci1yZXNvdXJjZSByZXBsYXkgaGFuZGxlciByZXBlYXRzOlxuICogcHJlc2VudC1rZXkgZmlsdGVyaW5nLCBwZXItZmllbGQgdHlwZSBjb2VyY2lvbiwgdW5rbm93bi1rZXkgcmVqZWN0aW9uLCB0aGVcbiAqIGZpbmQtb3ItY3JlYXRlIHVwc2VydCwgdGhlIGRlbGV0ZSBicmFuY2gsIG9wdGlvbmFsIHNuYXBzaG90IHNlcmlhbGl6YXRpb24sXG4gKiBhbmQgdGhlIGRvbWFpbiBhZnRlci1hcHBseSB0YWlsLiBBcHBzIGRlY2xhcmUgb25seSB0aGUgZmllbGQgbWFwIGFuZCBob29rcy5cbiAqIEBkZXByZWNhdGVkIFByZWZlciByZXNvdXJjZS1yb3V0ZWQgcmVwbGF5IChgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZWAgd2l0aCBgY29uZmlndXJhdGlvbmAvYHJlc291cmNlVHlwZU92ZXJyaWRlc2AgYW5kIHJlc291cmNlIGB3cml0YWJsZUF0dHJpYnV0ZXNgIHBlcm1pdCBsaXN0cykg4oCUIHZhbHVlIGNhc3RpbmcgYW5kIHZhbGlkYXRpb24gYmVsb25nIHRvIHRoZSByZWNvcmQgbGF5ZXIuIFRoaXMgYXBwbGllciByZW1haW5zIGZvciByZWxlYXNlZCBhcHBseUhhbmRsZXJzIGFkb3B0ZXJzIGFuZCB3aWxsIGJlIHJlbW92ZWQgYWZ0ZXIgdGhlaXIgbWlncmF0aW9uLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jUmVwbGF5VXBzZXJ0QXBwbGllciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZGVjbGFyYXRpdmUgdXBzZXJ0IGFwcGxpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXBwbGllciBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyByZWNlaXZpbmcgdGhlIG11dGF0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB7dHlwZTogc3RyaW5nLCBjb2x1bW4/OiBzdHJpbmd9IHwgKCh2YWx1ZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGxhYmVsOiBzdHJpbmcpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KT59IGFyZ3MuZmllbGRzIC0gRGF0YS1rZXkg4oaSIGZpZWxkLXR5cGUgbWFwOiBhIG5hbWVkIHR5cGUsIGEge3R5cGUsIGNvbHVtbn0gcmVuYW1lIHNwZWMsIFwiaWdub3JlZFwiIGZvciBhY2NlcHRlZC1idXQtZHJvcHBlZCBrZXlzLCBvciBhIGN1c3RvbSBjb2VyY2VyIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7ZGF0YTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5maW5kUmVjb3JkXSAtIEN1c3RvbSByZWNvcmQgcmVzb2x2ZXIuIERlZmF1bHRzIHRvIGZpbmRCeSh7aWQ6IG11dGF0aW9uLnJlc291cmNlSWR9KS5cbiAgICogQHBhcmFtIHsoYXJnczoge211dGF0aW9uOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmZpbmRSZWNvcmRGb3JEZWxldGVdIC0gQ3VzdG9tIGRlbGV0ZSByZXNvbHZlci4gRGVmYXVsdHMgdG8gZmluZFJlY29yZC5cbiAgICogQHBhcmFtIHtcImVycm9yXCIgfCBcImlnbm9yZVwifSBbYXJncy5yZXN0QXJnc10gLSBVbmtub3duIGRhdGEta2V5IGhhbmRsaW5nLiBEZWZhdWx0cyB0byBcImVycm9yXCIuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHttYXBwZWRBdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG11dGF0aW9uOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB2b2lkPn0gW2FyZ3MuYWZ0ZXJBcHBseV0gLSBEb21haW4gdGFpbDsgaXRzIHJldHVybmVkIG9iamVjdCBtZXJnZXMgaW50byB0aGUgYXBwbHkgcmVzdWx0LlxuICAgKiBAcGFyYW0geyhhcmdzOiB7bXV0YXRpb246IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59KSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLnNlcmlhbGl6ZV0gLSBTbmFwc2hvdCBzZXJpYWxpemVyOyByZXN1bHQgbGFuZHMgb24gYXBwbHlSZXN1bHQuc2VyaWFsaXplZERhdGEuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWZ0ZXJBcHBseSwgZmllbGRzLCBmaW5kUmVjb3JkLCBmaW5kUmVjb3JkRm9yRGVsZXRlLCBtb2RlbENsYXNzLCByZXN0QXJncyA9IFwiZXJyb3JcIiwgc2VyaWFsaXplfSkge1xuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwiU3luY1JlcGxheVVwc2VydEFwcGxpZXIgcmVxdWlyZXMgYSBtb2RlbENsYXNzXCIpXG4gICAgaWYgKCFmaWVsZHMgfHwgdHlwZW9mIGZpZWxkcyAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IEVycm9yKFwiU3luY1JlcGxheVVwc2VydEFwcGxpZXIgcmVxdWlyZXMgYSBmaWVsZHMgbWFwXCIpXG4gICAgaWYgKHJlc3RBcmdzICE9PSBcImVycm9yXCIgJiYgcmVzdEFyZ3MgIT09IFwiaWdub3JlXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY1JlcGxheVVwc2VydEFwcGxpZXIgcmVzdEFyZ3MgbXVzdCBiZSBcImVycm9yXCIgb3IgXCJpZ25vcmVcIiwgZ290OiAke1N0cmluZyhyZXN0QXJncyl9YClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtmaWVsZE5hbWUsIGZpZWxkU3BlY10gb2YgT2JqZWN0LmVudHJpZXMoZmllbGRzKSkge1xuICAgICAgaWYgKHR5cGVvZiBmaWVsZFNwZWMgPT09IFwiZnVuY3Rpb25cIikgY29udGludWVcblxuICAgICAgY29uc3QgZmllbGRUeXBlID0gdHlwZW9mIGZpZWxkU3BlYyA9PT0gXCJzdHJpbmdcIiA/IGZpZWxkU3BlYyA6IGZpZWxkU3BlYy50eXBlXG5cbiAgICAgIGlmIChmaWVsZFR5cGUgIT09IFwiaWdub3JlZFwiICYmICEoZmllbGRUeXBlIGluIEZJRUxEX1RZUEVTKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gc3luYyBmaWVsZCB0eXBlOiAke2ZpZWxkVHlwZX0gZm9yOiAke2ZpZWxkTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuYWZ0ZXJBcHBseSA9IGFmdGVyQXBwbHlcbiAgICB0aGlzLmZpZWxkcyA9IGZpZWxkc1xuICAgIHRoaXMuZmluZFJlY29yZCA9IGZpbmRSZWNvcmRcbiAgICB0aGlzLmZpbmRSZWNvcmRGb3JEZWxldGUgPSBmaW5kUmVjb3JkRm9yRGVsZXRlXG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMucmVzdEFyZ3MgPSByZXN0QXJnc1xuICAgIHRoaXMuc2VyaWFsaXplID0gc2VyaWFsaXplXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgbm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24gdG8gdGhlIGRlY2xhcmVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIFJlcGxheSBhcHBseSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEFwcGx5IHJlc3VsdCB3aXRoIHRoZSByZWNvcmQsIGNyZWF0ZWQvZGVsZXRlZCBmbGFncywgb3B0aW9uYWwgc2VyaWFsaXplZERhdGEsIGFuZCBhZnRlckFwcGx5IGV4dHJhcy5cbiAgICovXG4gIGFzeW5jIGFwcGx5KHtjb250ZXh0LCBtdXRhdGlvbn0pIHtcbiAgICBpZiAobXV0YXRpb24uc3luY1R5cGUgPT09IFwiZGVsZXRlXCIpIHJldHVybiBhd2FpdCB0aGlzLmFwcGx5RGVsZXRlKHtjb250ZXh0LCBtdXRhdGlvbn0pXG5cbiAgICBjb25zdCBtYXBwZWRBdHRyaWJ1dGVzID0gdGhpcy5tYXBwZWRBdHRyaWJ1dGVzKG11dGF0aW9uLmRhdGEpXG4gICAgY29uc3QgcmVjb3JkID0gdGhpcy5maW5kUmVjb3JkXG4gICAgICA/IGF3YWl0IHRoaXMuZmluZFJlY29yZCh7Y29udGV4dCwgZGF0YTogbXV0YXRpb24uZGF0YSwgbXV0YXRpb259KVxuICAgICAgOiBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZmluZEJ5KHtpZDogbXV0YXRpb24ucmVzb3VyY2VJZH0pXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge2NyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiBmYWxzZSwgcmVjb3JkOiBudWxsfVxuXG4gICAgaWYgKHJlY29yZCkge1xuICAgICAgcmVjb3JkLmFzc2lnbihtYXBwZWRBdHRyaWJ1dGVzKVxuICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgICAgcmVzdWx0LnJlY29yZCA9IHJlY29yZFxuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQucmVjb3JkID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmNyZWF0ZSh7aWQ6IG11dGF0aW9uLnJlc291cmNlSWQsIC4uLm1hcHBlZEF0dHJpYnV0ZXN9KVxuICAgICAgcmVzdWx0LmNyZWF0ZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2VyaWFsaXplKSByZXN1bHQuc2VyaWFsaXplZERhdGEgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZSh7Y29udGV4dCwgbXV0YXRpb24sIHJlY29yZDogcmVzdWx0LnJlY29yZH0pXG5cbiAgICBpZiAodGhpcy5hZnRlckFwcGx5KSB7XG4gICAgICBjb25zdCBhZnRlckFwcGx5UmVzdWx0ID0gYXdhaXQgdGhpcy5hZnRlckFwcGx5KHtjb250ZXh0LCBtYXBwZWRBdHRyaWJ1dGVzLCBtdXRhdGlvbiwgcmVjb3JkOiByZXN1bHQucmVjb3JkfSlcblxuICAgICAgaWYgKGFmdGVyQXBwbHlSZXN1bHQgJiYgdHlwZW9mIGFmdGVyQXBwbHlSZXN1bHQgPT09IFwib2JqZWN0XCIpIE9iamVjdC5hc3NpZ24ocmVzdWx0LCBhZnRlckFwcGx5UmVzdWx0KVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgZGVsZXRlIG11dGF0aW9uIHRvIHRoZSBkZWNsYXJlZCBtb2RlbC5cbiAgICogQHBhcmFtIHt7Y29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gRGVsZXRlIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXBwbHkgcmVzdWx0IHdpdGggdGhlIGRlbGV0ZWQgZmxhZy5cbiAgICovXG4gIGFzeW5jIGFwcGx5RGVsZXRlKHtjb250ZXh0LCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCByZXNvbHZlUmVjb3JkID0gdGhpcy5maW5kUmVjb3JkRm9yRGVsZXRlIHx8IHRoaXMuZmluZFJlY29yZFxuICAgIGNvbnN0IHJlY29yZCA9IHJlc29sdmVSZWNvcmRcbiAgICAgID8gYXdhaXQgcmVzb2x2ZVJlY29yZCh7Y29udGV4dCwgZGF0YTogbXV0YXRpb24uZGF0YSwgbXV0YXRpb259KVxuICAgICAgOiBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZmluZEJ5KHtpZDogbXV0YXRpb24ucmVzb3VyY2VJZH0pXG5cbiAgICBpZiAoIXJlY29yZCkgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgZGVsZXRlZDogZmFsc2UsIHJlY29yZDogbnVsbH1cblxuICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcblxuICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IHRydWUsIHJlY29yZH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIHByZXNlbnQgZGF0YSBrZXlzIHRocm91Z2ggdGhlIGRlY2xhcmVkIGZpZWxkIHR5cGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIE5vcm1hbGl6ZWQgbXV0YXRpb24gZGF0YS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQ29lcmNlZCBhdHRyaWJ1dGVzIGtleWVkIGJ5IGNvbHVtbiBuYW1lLlxuICAgKi9cbiAgbWFwcGVkQXR0cmlidXRlcyhkYXRhKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgbWFwcGVkQXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB1bmtub3duS2V5cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtkYXRhS2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YSkpIHtcbiAgICAgIGNvbnN0IGZpZWxkU3BlYyA9IHRoaXMuZmllbGRzW2RhdGFLZXldXG5cbiAgICAgIGlmICghZmllbGRTcGVjKSB7XG4gICAgICAgIHVua25vd25LZXlzLnB1c2goZGF0YUtleSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBmaWVsZFNwZWMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBtYXBwZWRBdHRyaWJ1dGVzW2RhdGFLZXldID0gZmllbGRTcGVjKHZhbHVlLCBkYXRhS2V5KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWVsZFR5cGUgPSB0eXBlb2YgZmllbGRTcGVjID09PSBcInN0cmluZ1wiID8gZmllbGRTcGVjIDogZmllbGRTcGVjLnR5cGVcblxuICAgICAgaWYgKGZpZWxkVHlwZSA9PT0gXCJpZ25vcmVkXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbHVtbiA9IHR5cGVvZiBmaWVsZFNwZWMgPT09IFwic3RyaW5nXCIgPyBkYXRhS2V5IDogZmllbGRTcGVjLmNvbHVtbiB8fCBkYXRhS2V5XG5cbiAgICAgIG1hcHBlZEF0dHJpYnV0ZXNbY29sdW1uXSA9IEZJRUxEX1RZUEVTW2ZpZWxkVHlwZV0odmFsdWUsIGRhdGFLZXkpXG4gICAgfVxuXG4gICAgaWYgKHVua25vd25LZXlzLmxlbmd0aCA+IDAgJiYgdGhpcy5yZXN0QXJncyA9PT0gXCJlcnJvclwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gc3luYyBkYXRhIGtleXM6ICR7dW5rbm93bktleXMuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG1hcHBlZEF0dHJpYnV0ZXNcbiAgfVxufVxuIl19