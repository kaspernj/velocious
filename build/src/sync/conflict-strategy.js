/**
 * @typedef {null | string | number | boolean | unknown[] | Record<string, unknown>} SyncJsonValue
 */
/**
 * @typedef {object} SyncConflictRecord
 * @property {Record<string, SyncJsonValue>} attributes - Record attributes.
 * @property {string | number | boolean | null} [version] - Record version value.
 */
/**
 * @typedef {object} SyncConflictResult
 * @property {Record<string, SyncJsonValue>} [attributes] - Attributes to apply when replay may continue.
 * @property {Record<string, SyncJsonValue>} [conflict] - Structured conflict payload for the client/local log.
 * @property {"applied" | "conflict" | "rejected"} status - Conflict decision.
 * @property {string} strategy - Strategy that produced the decision.
 */
// @ts-check
const CONFLICT_STRATEGIES = new Set(["optimisticVersion", "serverWins", "lastWriterWins", "fieldThreeWay", "appendOnly"]);
/**
 * Evaluates a replay mutation against server/base state using a sync conflict strategy.
 * @param {object} args - Arguments.
 * @param {SyncConflictRecord | null} [args.baseRecord] - Record state observed when the mutation was made.
 * @param {(arg: object) => (SyncConflictResult | Promise<SyncConflictResult>)} [args.customHandler] - Resource-specific conflict hook.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Replayed mutation.
 * @param {SyncConflictRecord | null} [args.serverRecord] - Current authoritative server record.
 * @param {string} [args.strategy] - Conflict strategy.
 * @param {string} [args.versionAttribute] - Attribute used for optimistic version checks.
 * @returns {Promise<SyncConflictResult>} - Conflict decision.
 */
export async function resolveSyncConflict({ baseRecord = null, customHandler, mutation, serverRecord = null, strategy = "optimisticVersion", versionAttribute = "updatedAt" }) {
    if (customHandler)
        return normalizeConflictResult(await customHandler({ baseRecord, mutation, serverRecord, strategy, versionAttribute }), strategy);
    if (!CONFLICT_STRATEGIES.has(strategy))
        throw new Error(`Unknown sync conflict strategy '${strategy}'`);
    const mutationAttributes = mutationAttributesFor(mutation);
    if (strategy === "appendOnly" || strategy === "lastWriterWins")
        return { attributes: mutationAttributes, status: "applied", strategy };
    if (strategy === "fieldThreeWay")
        return fieldThreeWayResult({ baseRecord, mutation, serverRecord, strategy, versionAttribute });
    if (hasVersionConflict({ mutation, serverRecord, versionAttribute }))
        return conflictResult({ baseRecord, mutation, serverRecord, strategy, versionAttribute });
    return { attributes: mutationAttributes, status: "applied", strategy };
}
/**
 * Applies a server replay result to a local mutation-log record.
 * @param {object} args - Arguments.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {import("./local-mutation-log.js").LocalMutationLogRecord} args.record - Local mutation-log record.
 * @param {Record<string, SyncJsonValue>} args.result - Server replay result payload.
 * @returns {Promise<import("./local-mutation-log.js").LocalMutationLogRecord>} - Updated local record.
 */
export async function applySyncReplayResultToLocalMutationLog({ mutationLog, record, result }) {
    return await mutationLog.updateStatus({
        id: record.id,
        status: replayResultLocalStatus(result),
        syncResult: result
    });
}
/**
 * Maps a server replay result to a local mutation-log status.
 * @param {Record<string, SyncJsonValue>} result - Replay result.
 * @returns {import("./local-mutation-log.js").LocalMutationStatus} - Local mutation-log status.
 */
export function replayResultLocalStatus(result) {
    if (result.syncState === "conflict")
        return "conflict";
    if (result.syncState === "failed" || result.syncState === "rejected")
        return "rejected";
    if (result.syncState === "successful" || result.syncState === "duplicate")
        return "synced";
    if (result.status === "conflict")
        return "conflict";
    if (result.status === "error" || result.status === "rejected")
        return "rejected";
    if (result.status === "success" && replayResultHasFailedApplication(result))
        return "rejected";
    if (result.status === "success" || result.status === "applied" || result.status === "duplicate")
        return "synced";
    throw new Error(`Unknown sync replay result status '${String(result.status)}'`);
}
/**
 * Checks whether an otherwise successful replay result contains a failed
 * frontend-model command or change-feed write.
 * @param {Record<string, SyncJsonValue>} result - Replay result.
 * @returns {boolean} - Whether the local mutation must stay unsynced.
 */
function replayResultHasFailedApplication(result) {
    if (result.serverSequence === null || result.serverChangeFeedStatus === "error")
        return true;
    if (!result.response || typeof result.response !== "object" || Array.isArray(result.response))
        return false;
    return /** @type {Record<string, SyncJsonValue>} */ (result.response).status === "error";
}
/**
 * Runs a field-level three-way merge.
 * @param {object} args - Arguments.
 * @param {SyncConflictRecord | null} args.baseRecord - Base record.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {SyncConflictRecord | null} args.serverRecord - Server record.
 * @param {string} args.strategy - Strategy.
 * @param {string} args.versionAttribute - Version attribute.
 * @returns {SyncConflictResult} - Conflict decision.
 */
function fieldThreeWayResult({ baseRecord, mutation, serverRecord, strategy, versionAttribute }) {
    if (!baseRecord || !serverRecord)
        return { attributes: mutationAttributesFor(mutation), status: "applied", strategy };
    const mutationAttributes = mutationAttributesFor(mutation);
    /** @type {string[]} */
    const affectedFields = [];
    /** @type {Record<string, SyncJsonValue>} */
    const mergedAttributes = {};
    for (const [field, localValue] of Object.entries(mutationAttributes)) {
        const baseValue = baseRecord.attributes[field];
        const serverValue = serverRecord.attributes[field];
        if (jsonValuesEqual(serverValue, baseValue) || jsonValuesEqual(serverValue, localValue)) {
            mergedAttributes[field] = localValue;
        }
        else {
            affectedFields.push(field);
        }
    }
    if (affectedFields.length > 0)
        return conflictResult({ affectedFields, baseRecord, mutation, serverRecord, strategy, versionAttribute });
    return { attributes: mergedAttributes, status: "applied", strategy };
}
/**
 * Checks whether current server state conflicts with a mutation base version.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {SyncConflictRecord | null} args.serverRecord - Server record.
 * @param {string} args.versionAttribute - Version attribute.
 * @returns {boolean} - Whether versions conflict.
 */
function hasVersionConflict({ mutation, serverRecord, versionAttribute }) {
    if (!serverRecord)
        return false;
    if (mutation.baseVersion === undefined || mutation.baseVersion === null)
        return false;
    const serverVersion = serverRecord.version ?? serverRecord.attributes[versionAttribute] ?? null;
    return !jsonValuesEqual(serverVersion, mutation.baseVersion);
}
/**
 * Builds a structured conflict result.
 * @param {object} args - Arguments.
 * @param {string[]} [args.affectedFields] - Explicit affected fields.
 * @param {SyncConflictRecord | null} args.baseRecord - Base record.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {SyncConflictRecord | null} args.serverRecord - Server record.
 * @param {string} args.strategy - Strategy.
 * @param {string} args.versionAttribute - Version attribute.
 * @returns {SyncConflictResult} - Conflict result.
 */
function conflictResult({ affectedFields, baseRecord, mutation, serverRecord, strategy, versionAttribute }) {
    const mutationAttributes = mutationAttributesFor(mutation);
    return {
        conflict: {
            affectedFields: affectedFields || Object.keys(mutationAttributes),
            baseRecord: baseRecord ? baseRecord.attributes : null,
            baseVersion: /** @type {SyncJsonValue} */ (mutation.baseVersion ?? null),
            localMutation: {
                attributes: mutationAttributes,
                clientMutationId: mutation.clientMutationId,
                model: mutation.model,
                operation: mutation.operation,
                payload: /** @type {SyncJsonValue} */ (mutation.payload || null)
            },
            serverModel: serverRecord ? serverRecord.attributes : null,
            serverVersion: serverRecord ? /** @type {SyncJsonValue} */ (serverRecord.version ?? serverRecord.attributes[versionAttribute] ?? null) : null,
            suggestedResolution: strategy === "serverWins" ? "keep_server" : "manual",
            versionAttribute
        },
        status: "conflict",
        strategy
    };
}
/**
 * Normalizes a custom resource conflict result.
 * @param {unknown} result - Raw result.
 * @param {string} strategy - Requested strategy.
 * @returns {SyncConflictResult} - Normalized result.
 */
function normalizeConflictResult(result, strategy) {
    if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error("Sync conflict handler must return an object");
    const resultRecord = /** @type {Record<string, unknown>} */ (result);
    if (!["applied", "conflict", "rejected"].includes(String(resultRecord.status)))
        throw new Error("Sync conflict handler returned an unknown status");
    return /** @type {SyncConflictResult} */ ({ strategy, ...resultRecord });
}
/**
 * Returns mutation attributes as a JSON object.
 * @param {import("./device-identity.js").SyncMutation} mutation - Mutation.
 * @returns {Record<string, SyncJsonValue>} - Attributes.
 */
function mutationAttributesFor(mutation) {
    if (!mutation.attributes || typeof mutation.attributes !== "object" || Array.isArray(mutation.attributes))
        return {};
    return /** @type {Record<string, SyncJsonValue>} */ (JSON.parse(JSON.stringify(mutation.attributes)));
}
/**
 * Compares JSON values by stable serialization.
 * @param {unknown} left - Left value.
 * @param {unknown} right - Right value.
 * @returns {boolean} - Whether values match.
 */
function jsonValuesEqual(left, right) {
    return stableJsonStringify(left) === stableJsonStringify(right);
}
/**
 * Stable JSON stringify helper.
 * @param {unknown} value - Value.
 * @returns {string} - Stable JSON.
 */
function stableJsonStringify(value) {
    if (Array.isArray(value))
        return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(/** @type {Record<string, unknown>} */ (value)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmxpY3Qtc3RyYXRlZ3kuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9jb25mbGljdC1zdHJhdGVneS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7Ozs7O0dBTUc7QUFDSCxZQUFZO0FBRVosTUFBTSxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLG1CQUFtQixFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSxlQUFlLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQTtBQUV6SDs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxFQUFDLFVBQVUsR0FBRyxJQUFJLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxZQUFZLEdBQUcsSUFBSSxFQUFFLFFBQVEsR0FBRyxtQkFBbUIsRUFBRSxnQkFBZ0IsR0FBRyxXQUFXLEVBQUM7SUFDekssSUFBSSxhQUFhO1FBQUUsT0FBTyx1QkFBdUIsQ0FBQyxNQUFNLGFBQWEsQ0FBQyxFQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxnQkFBZ0IsRUFBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDbEosSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxRQUFRLEdBQUcsQ0FBQyxDQUFBO0lBRXZHLE1BQU0sa0JBQWtCLEdBQUcscUJBQXFCLENBQUMsUUFBUSxDQUFDLENBQUE7SUFFMUQsSUFBSSxRQUFRLEtBQUssWUFBWSxJQUFJLFFBQVEsS0FBSyxnQkFBZ0I7UUFBRSxPQUFPLEVBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFDLENBQUE7SUFDcEksSUFBSSxRQUFRLEtBQUssZUFBZTtRQUFFLE9BQU8sbUJB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QTtJQUVwSCxPQUFPLDRDQUE0QyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDdkcsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxlQUFlLENBQUMsSUFBSSxFQUFFLEtBQUs7SUFDbEMsT0FBTyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsS0FBSyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtBQUNqRSxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsbUJBQW1CLENBQUMsS0FBSztJQUNoQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUE7SUFDbEcsSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDdkMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksbUJBQW1CLENBQUMsc0NBQXNDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQTtJQUN0SyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQzlCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEB0eXBlZGVmIHtudWxsIHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IHVua25vd25bXSB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+fSBTeW5jSnNvblZhbHVlXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY0NvbmZsaWN0UmVjb3JkXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFN5bmNKc29uVmFsdWU+fSBhdHRyaWJ1dGVzIC0gUmVjb3JkIGF0dHJpYnV0ZXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsfSBbdmVyc2lvbl0gLSBSZWNvcmQgdmVyc2lvbiB2YWx1ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jQ29uZmxpY3RSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgU3luY0pzb25WYWx1ZT59IFthdHRyaWJ1dGVzXSAtIEF0dHJpYnV0ZXMgdG8gYXBwbHkgd2hlbiByZXBsYXkgbWF5IGNvbnRpbnVlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBTeW5jSnNvblZhbHVlPn0gW2NvbmZsaWN0XSAtIFN0cnVjdHVyZWQgY29uZmxpY3QgcGF5bG9hZCBmb3IgdGhlIGNsaWVudC9sb2NhbCBsb2cuXG4gKiBAcHJvcGVydHkge1wiYXBwbGllZFwiIHwgXCJjb25mbGljdFwiIHwgXCJyZWplY3RlZFwifSBzdGF0dXMgLSBDb25mbGljdCBkZWNpc2lvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdHJhdGVneSAtIFN0cmF0ZWd5IHRoYXQgcHJvZHVjZWQgdGhlIGRlY2lzaW9uLlxuICovXG4vLyBAdHMtY2hlY2tcblxuY29uc3QgQ09ORkxJQ1RfU1RSQVRFR0lFUyA9IG5ldyBTZXQoW1wib3B0aW1pc3RpY1ZlcnNpb25cIiwgXCJzZXJ2ZXJXaW5zXCIsIFwibGFzdFdyaXRlcldpbnNcIiwgXCJmaWVsZFRocmVlV2F5XCIsIFwiYXBwZW5kT25seVwiXSlcblxuLyoqXG4gKiBFdmFsdWF0ZXMgYSByZXBsYXkgbXV0YXRpb24gYWdhaW5zdCBzZXJ2ZXIvYmFzZSBzdGF0ZSB1c2luZyBhIHN5bmMgY29uZmxpY3Qgc3RyYXRlZ3kuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7U3luY0NvbmZsaWN0UmVjb3JkIHwgbnVsbH0gW2FyZ3MuYmFzZVJlY29yZF0gLSBSZWNvcmQgc3RhdGUgb2JzZXJ2ZWQgd2hlbiB0aGUgbXV0YXRpb24gd2FzIG1hZGUuXG4gKiBAcGFyYW0geyhhcmc6IG9iamVjdCkgPT4gKFN5bmNDb25mbGljdFJlc3VsdCB8IFByb21pc2U8U3luY0NvbmZsaWN0UmVzdWx0Pil9IFthcmdzLmN1c3RvbUhhbmRsZXJdIC0gUmVzb3VyY2Utc3BlY2lmaWMgY29uZmxpY3QgaG9vay5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gUmVwbGF5ZWQgbXV0YXRpb24uXG4gKiBAcGFyYW0ge1N5bmNDb25mbGljdFJlY29yZCB8IG51bGx9IFthcmdzLnNlcnZlclJlY29yZF0gLSBDdXJyZW50IGF1dGhvcml0YXRpdmUgc2VydmVyIHJlY29yZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdHJhdGVneV0gLSBDb25mbGljdCBzdHJhdGVneS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy52ZXJzaW9uQXR0cmlidXRlXSAtIEF0dHJpYnV0ZSB1c2VkIGZvciBvcHRpbWlzdGljIHZlcnNpb24gY2hlY2tzLlxuICogQHJldHVybnMge1Byb21pc2U8U3luY0NvbmZsaWN0UmVzdWx0Pn0gLSBDb25mbGljdCBkZWNpc2lvbi5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVTeW5jQ29uZmxpY3Qoe2Jhc2VSZWNvcmQgPSBudWxsLCBjdXN0b21IYW5kbGVyLCBtdXRhdGlvbiwgc2VydmVyUmVjb3JkID0gbnVsbCwgc3RyYXRlZ3kgPSBcIm9wdGltaXN0aWNWZXJzaW9uXCIsIHZlcnNpb25BdHRyaWJ1dGUgPSBcInVwZGF0ZWRBdFwifSkge1xuICBpZiAoY3VzdG9tSGFuZGxlcikgcmV0dXJuIG5vcm1hbGl6ZUNvbmZsaWN0UmVzdWx0KGF3YWl0IGN1c3RvbUhhbmRsZXIoe2Jhc2VSZWNvcmQsIG11dGF0aW9uLCBzZXJ2ZXJSZWNvcmQsIHN0cmF0ZWd5LCB2ZXJzaW9uQXR0cmlidXRlfSksIHN0cmF0ZWd5KVxuICBpZiAoIUNPTkZMSUNUX1NUUkFURUdJRVMuaGFzKHN0cmF0ZWd5KSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHN5bmMgY29uZmxpY3Qgc3RyYXRlZ3kgJyR7c3RyYXRlZ3l9J2ApXG5cbiAgY29uc3QgbXV0YXRpb25BdHRyaWJ1dGVzID0gbXV0YXRpb25BdHRyaWJ1dGVzRm9yKG11dGF0aW9uKVxuXG4gIGlmIChzdHJhdGVneSA9PT0gXCJhcHBlbmRPbmx5XCIgfHwgc3RyYXRlZ3kgPT09IFwibGFzdFdyaXRlcldpbnNcIikgcmV0dXJuIHthdHRyaWJ1dGVzOiBtdXRhdGlvbkF0dHJpYnV0ZXMsIHN0YXR1czogXCJhcHBsaWVkXCIsIHN0cmF0ZWd5fVxuICBpZiAoc3RyYXRlZ3kgPT09IFwiZmllbGRUaHJlZVdheVwiKSByZXR1cm4gZmllbGRUaHJlZVdheVJlc3VsdCh7YmFzZVJlY29yZCwgbXV0YXRpb24sIHNlcnZlclJlY29yZCwgc3RyYXRlZ3ksIHZlcnNpb25BdHRyaWJ1dGV9KVxuICBpZiAoaGFzVmVyc2lvbkNvbmZsaWN0KHttdXRhdGlvbiwgc2VydmVyUmVjb3JkLCB2ZXJzaW9uQXR0cmlidXRlfSkpIHJldHVybiBjb25mbGljdFJlc3VsdCh7YmFzZVJlY29yZCwgbXV0YXRpb24sIHNlcnZlclJlY29yZCwgc3RyYXRlZ3ksIHZlcnNpb25BdHRyaWJ1dGV9KVxuXG4gIHJldHVybiB7YXR0cmlidXRlczogbXV0YXRpb25BdHRyaWJ1dGVzLCBzdGF0dXM6IFwiYXBwbGllZFwiLCBzdHJhdGVneX1cbn1cblxuLyoqXG4gKiBBcHBsaWVzIGEgc2VydmVyIHJlcGxheSByZXN1bHQgdG8gYSBsb2NhbCBtdXRhdGlvbi1sb2cgcmVjb3JkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHR9IGFyZ3MubXV0YXRpb25Mb2cgLSBMb2NhbCBtdXRhdGlvbiBsb2cuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IGFyZ3MucmVjb3JkIC0gTG9jYWwgbXV0YXRpb24tbG9nIHJlY29yZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgU3luY0pzb25WYWx1ZT59IGFyZ3MucmVzdWx0IC0gU2VydmVyIHJlcGxheSByZXN1bHQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSAtIFVwZGF0ZWQgbG9jYWwgcmVjb3JkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwbHlTeW5jUmVwbGF5UmVzdWx0VG9Mb2NhbE11dGF0aW9uTG9nKHttdXRhdGlvbkxvZywgcmVjb3JkLCByZXN1bHR9KSB7XG4gIHJldHVybiBhd2FpdCBtdXRhdGlvbkxvZy51cGRhdGVTdGF0dXMoe1xuICAgIGlkOiByZWNvcmQuaWQsXG4gICAgc3RhdHVzOiByZXBsYXlSZXN1bHRMb2NhbFN0YXR1cyhyZXN1bHQpLFxuICAgIHN5bmNSZXN1bHQ6IHJlc3VsdFxuICB9KVxufVxuXG4vKipcbiAqIE1hcHMgYSBzZXJ2ZXIgcmVwbGF5IHJlc3VsdCB0byBhIGxvY2FsIG11dGF0aW9uLWxvZyBzdGF0dXMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFN5bmNKc29uVmFsdWU+fSByZXN1bHQgLSBSZXBsYXkgcmVzdWx0LlxuICogQHJldHVybnMge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25TdGF0dXN9IC0gTG9jYWwgbXV0YXRpb24tbG9nIHN0YXR1cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlcGxheVJlc3VsdExvY2FsU3RhdHVzKHJlc3VsdCkge1xuICBpZiAocmVzdWx0LnN5bmNTdGF0ZSA9PT0gXCJjb25mbGljdFwiKSByZXR1cm4gXCJjb25mbGljdFwiXG4gIGlmIChyZXN1bHQuc3luY1N0YXRlID09PSBcImZhaWxlZFwiIHx8IHJlc3VsdC5zeW5jU3RhdGUgPT09IFwicmVqZWN0ZWRcIikgcmV0dXJuIFwicmVqZWN0ZWRcIlxuICBpZiAocmVzdWx0LnN5bmNTdGF0ZSA9PT0gXCJzdWNjZXNzZnVsXCIgfHwgcmVzdWx0LnN5bmNTdGF0ZSA9PT0gXCJkdXBsaWNhdGVcIikgcmV0dXJuIFwic3luY2VkXCJcbiAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwiY29uZmxpY3RcIikgcmV0dXJuIFwiY29uZmxpY3RcIlxuICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJlcnJvclwiIHx8IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikgcmV0dXJuIFwicmVqZWN0ZWRcIlxuICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJzdWNjZXNzXCIgJiYgcmVwbGF5UmVzdWx0SGFzRmFpbGVkQXBwbGljYXRpb24ocmVzdWx0KSkgcmV0dXJuIFwicmVqZWN0ZWRcIlxuICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJzdWNjZXNzXCIgfHwgcmVzdWx0LnN0YXR1cyA9PT0gXCJhcHBsaWVkXCIgfHwgcmVzdWx0LnN0YXR1cyA9PT0gXCJkdXBsaWNhdGVcIikgcmV0dXJuIFwic3luY2VkXCJcblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gc3luYyByZXBsYXkgcmVzdWx0IHN0YXR1cyAnJHtTdHJpbmcocmVzdWx0LnN0YXR1cyl9J2ApXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gb3RoZXJ3aXNlIHN1Y2Nlc3NmdWwgcmVwbGF5IHJlc3VsdCBjb250YWlucyBhIGZhaWxlZFxuICogZnJvbnRlbmQtbW9kZWwgY29tbWFuZCBvciBjaGFuZ2UtZmVlZCB3cml0ZS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgU3luY0pzb25WYWx1ZT59IHJlc3VsdCAtIFJlcGxheSByZXN1bHQuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBsb2NhbCBtdXRhdGlvbiBtdXN0IHN0YXkgdW5zeW5jZWQuXG4gKi9cbmZ1bmN0aW9uIHJlcGxheVJlc3VsdEhhc0ZhaWxlZEFwcGxpY2F0aW9uKHJlc3VsdCkge1xuICBpZiAocmVzdWx0LnNlcnZlclNlcXVlbmNlID09PSBudWxsIHx8IHJlc3VsdC5zZXJ2ZXJDaGFuZ2VGZWVkU3RhdHVzID09PSBcImVycm9yXCIpIHJldHVybiB0cnVlXG4gIGlmICghcmVzdWx0LnJlc3BvbnNlIHx8IHR5cGVvZiByZXN1bHQucmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyZXN1bHQucmVzcG9uc2UpKSByZXR1cm4gZmFsc2VcblxuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBTeW5jSnNvblZhbHVlPn0gKi8gKHJlc3VsdC5yZXNwb25zZSkuc3RhdHVzID09PSBcImVycm9yXCJcbn1cblxuLyoqXG4gKiBSdW5zIGEgZmllbGQtbGV2ZWwgdGhyZWUtd2F5IG1lcmdlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1N5bmNDb25mbGljdFJlY29yZCB8IG51bGx9IGFyZ3MuYmFzZVJlY29yZCAtIEJhc2UgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBNdXRhdGlvbi5cbiAqIEBwYXJhbSB7U3luY0NvbmZsaWN0UmVjb3JkIHwgbnVsbH0gYXJncy5zZXJ2ZXJSZWNvcmQgLSBTZXJ2ZXIgcmVjb3JkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RyYXRlZ3kgLSBTdHJhdGVneS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZlcnNpb25BdHRyaWJ1dGUgLSBWZXJzaW9uIGF0dHJpYnV0ZS5cbiAqIEByZXR1cm5zIHtTeW5jQ29uZmxpY3RSZXN1bHR9IC0gQ29uZmxpY3QgZGVjaXNpb24uXG4gKi9cbmZ1bmN0aW9uIGZpZWxkVGhyZWVXYXlSZXN1bHQoe2Jhc2VSZWNvcmQsIG11dGF0aW9uLCBzZXJ2ZXJSZWNvcmQsIHN0cmF0ZWd5LCB2ZXJzaW9uQXR0cmlidXRlfSkge1xuICBpZiAoIWJhc2VSZWNvcmQgfHwgIXNlcnZlclJlY29yZCkgcmV0dXJuIHthdHRyaWJ1dGVzOiBtdXRhdGlvbkF0dHJpYnV0ZXNGb3IobXV0YXRpb24pLCBzdGF0dXM6IFwiYXBwbGllZFwiLCBzdHJhdGVneX1cblxuICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBtdXRhdGlvbkF0dHJpYnV0ZXNGb3IobXV0YXRpb24pXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGFmZmVjdGVkRmllbGRzID0gW11cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBTeW5jSnNvblZhbHVlPn0gKi9cbiAgY29uc3QgbWVyZ2VkQXR0cmlidXRlcyA9IHt9XG5cbiAgZm9yIChjb25zdCBbZmllbGQsIGxvY2FsVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG11dGF0aW9uQXR0cmlidXRlcykpIHtcbiAgICBjb25zdCBiYXNlVmFsdWUgPSBiYXNlUmVjb3JkLmF0dHJpYnV0ZXNbZmllbGRdXG4gICAgY29uc3Qgc2VydmVyVmFsdWUgPSBzZXJ2ZXJSZWNvcmQuYXR0cmlidXRlc1tmaWVsZF1cblxuICAgIGlmIChqc29uVmFsdWVzRXF1YWwoc2VydmVyVmFsdWUsIGJhc2VWYWx1ZSkgfHwganNvblZhbHVlc0VxdWFsKHNlcnZlclZhbHVlLCBsb2NhbFZhbHVlKSkge1xuICAgICAgbWVyZ2VkQXR0cmlidXRlc1tmaWVsZF0gPSBsb2NhbFZhbHVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGFmZmVjdGVkRmllbGRzLnB1c2goZmllbGQpXG4gICAgfVxuICB9XG5cbiAgaWYgKGFmZmVjdGVkRmllbGRzLmxlbmd0aCA+IDApIHJldHVybiBjb25mbGljdFJlc3VsdCh7YWZmZWN0ZWRGaWVsZHMsIGJhc2VSZWNvcmQsIG11dGF0aW9uLCBzZXJ2ZXJSZWNvcmQsIHN0cmF0ZWd5LCB2ZXJzaW9uQXR0cmlidXRlfSlcblxuICByZXR1cm4ge2F0dHJpYnV0ZXM6IG1lcmdlZEF0dHJpYnV0ZXMsIHN0YXR1czogXCJhcHBsaWVkXCIsIHN0cmF0ZWd5fVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGN1cnJlbnQgc2VydmVyIHN0YXRlIGNvbmZsaWN0cyB3aXRoIGEgbXV0YXRpb24gYmFzZSB2ZXJzaW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE11dGF0aW9uLlxuICogQHBhcmFtIHtTeW5jQ29uZmxpY3RSZWNvcmQgfCBudWxsfSBhcmdzLnNlcnZlclJlY29yZCAtIFNlcnZlciByZWNvcmQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy52ZXJzaW9uQXR0cmlidXRlIC0gVmVyc2lvbiBhdHRyaWJ1dGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZlcnNpb25zIGNvbmZsaWN0LlxuICovXG5mdW5jdGlvbiBoYXNWZXJzaW9uQ29uZmxpY3Qoe211dGF0aW9uLCBzZXJ2ZXJSZWNvcmQsIHZlcnNpb25BdHRyaWJ1dGV9KSB7XG4gIGlmICghc2VydmVyUmVjb3JkKSByZXR1cm4gZmFsc2VcbiAgaWYgKG11dGF0aW9uLmJhc2VWZXJzaW9uID09PSB1bmRlZmluZWQgfHwgbXV0YXRpb24uYmFzZVZlcnNpb24gPT09IG51bGwpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHNlcnZlclZlcnNpb24gPSBzZXJ2ZXJSZWNvcmQudmVyc2lvbiA/PyBzZXJ2ZXJSZWNvcmQuYXR0cmlidXRlc1t2ZXJzaW9uQXR0cmlidXRlXSA/PyBudWxsXG5cbiAgcmV0dXJuICFqc29uVmFsdWVzRXF1YWwoc2VydmVyVmVyc2lvbiwgbXV0YXRpb24uYmFzZVZlcnNpb24pXG59XG5cbi8qKlxuICogQnVpbGRzIGEgc3RydWN0dXJlZCBjb25mbGljdCByZXN1bHQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmFmZmVjdGVkRmllbGRzXSAtIEV4cGxpY2l0IGFmZmVjdGVkIGZpZWxkcy5cbiAqIEBwYXJhbSB7U3luY0NvbmZsaWN0UmVjb3JkIHwgbnVsbH0gYXJncy5iYXNlUmVjb3JkIC0gQmFzZSByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE11dGF0aW9uLlxuICogQHBhcmFtIHtTeW5jQ29uZmxpY3RSZWNvcmQgfCBudWxsfSBhcmdzLnNlcnZlclJlY29yZCAtIFNlcnZlciByZWNvcmQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdHJhdGVneSAtIFN0cmF0ZWd5LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudmVyc2lvbkF0dHJpYnV0ZSAtIFZlcnNpb24gYXR0cmlidXRlLlxuICogQHJldHVybnMge1N5bmNDb25mbGljdFJlc3VsdH0gLSBDb25mbGljdCByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIGNvbmZsaWN0UmVzdWx0KHthZmZlY3RlZEZpZWxkcywgYmFzZVJlY29yZCwgbXV0YXRpb24sIHNlcnZlclJlY29yZCwgc3RyYXRlZ3ksIHZlcnNpb25BdHRyaWJ1dGV9KSB7XG4gIGNvbnN0IG11dGF0aW9uQXR0cmlidXRlcyA9IG11dGF0aW9uQXR0cmlidXRlc0ZvcihtdXRhdGlvbilcblxuICByZXR1cm4ge1xuICAgIGNvbmZsaWN0OiB7XG4gICAgICBhZmZlY3RlZEZpZWxkczogYWZmZWN0ZWRGaWVsZHMgfHwgT2JqZWN0LmtleXMobXV0YXRpb25BdHRyaWJ1dGVzKSxcbiAgICAgIGJhc2VSZWNvcmQ6IGJhc2VSZWNvcmQgPyBiYXNlUmVjb3JkLmF0dHJpYnV0ZXMgOiBudWxsLFxuICAgICAgYmFzZVZlcnNpb246IC8qKiBAdHlwZSB7U3luY0pzb25WYWx1ZX0gKi8gKG11dGF0aW9uLmJhc2VWZXJzaW9uID8/IG51bGwpLFxuICAgICAgbG9jYWxNdXRhdGlvbjoge1xuICAgICAgICBhdHRyaWJ1dGVzOiBtdXRhdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQ6IG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIG1vZGVsOiBtdXRhdGlvbi5tb2RlbCxcbiAgICAgICAgb3BlcmF0aW9uOiBtdXRhdGlvbi5vcGVyYXRpb24sXG4gICAgICAgIHBheWxvYWQ6IC8qKiBAdHlwZSB7U3luY0pzb25WYWx1ZX0gKi8gKG11dGF0aW9uLnBheWxvYWQgfHwgbnVsbClcbiAgICAgIH0sXG4gICAgICBzZXJ2ZXJNb2RlbDogc2VydmVyUmVjb3JkID8gc2VydmVyUmVjb3JkLmF0dHJpYnV0ZXMgOiBudWxsLFxuICAgICAgc2VydmVyVmVyc2lvbjogc2VydmVyUmVjb3JkID8gLyoqIEB0eXBlIHtTeW5jSnNvblZhbHVlfSAqLyAoc2VydmVyUmVjb3JkLnZlcnNpb24gPz8gc2VydmVyUmVjb3JkLmF0dHJpYnV0ZXNbdmVyc2lvbkF0dHJpYnV0ZV0gPz8gbnVsbCkgOiBudWxsLFxuICAgICAgc3VnZ2VzdGVkUmVzb2x1dGlvbjogc3RyYXRlZ3kgPT09IFwic2VydmVyV2luc1wiID8gXCJrZWVwX3NlcnZlclwiIDogXCJtYW51YWxcIixcbiAgICAgIHZlcnNpb25BdHRyaWJ1dGVcbiAgICB9LFxuICAgIHN0YXR1czogXCJjb25mbGljdFwiLFxuICAgIHN0cmF0ZWd5XG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY3VzdG9tIHJlc291cmNlIGNvbmZsaWN0IHJlc3VsdC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gcmVzdWx0IC0gUmF3IHJlc3VsdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdHJhdGVneSAtIFJlcXVlc3RlZCBzdHJhdGVneS5cbiAqIEByZXR1cm5zIHtTeW5jQ29uZmxpY3RSZXN1bHR9IC0gTm9ybWFsaXplZCByZXN1bHQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbmZsaWN0UmVzdWx0KHJlc3VsdCwgc3RyYXRlZ3kpIHtcbiAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJlc3VsdCkpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY29uZmxpY3QgaGFuZGxlciBtdXN0IHJldHVybiBhbiBvYmplY3RcIilcbiAgY29uc3QgcmVzdWx0UmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHJlc3VsdClcbiAgaWYgKCFbXCJhcHBsaWVkXCIsIFwiY29uZmxpY3RcIiwgXCJyZWplY3RlZFwiXS5pbmNsdWRlcyhTdHJpbmcocmVzdWx0UmVjb3JkLnN0YXR1cykpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNvbmZsaWN0IGhhbmRsZXIgcmV0dXJuZWQgYW4gdW5rbm93biBzdGF0dXNcIilcblxuICByZXR1cm4gLyoqIEB0eXBlIHtTeW5jQ29uZmxpY3RSZXN1bHR9ICovICh7c3RyYXRlZ3ksIC4uLnJlc3VsdFJlY29yZH0pXG59XG5cbi8qKlxuICogUmV0dXJucyBtdXRhdGlvbiBhdHRyaWJ1dGVzIGFzIGEgSlNPTiBvYmplY3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBNdXRhdGlvbi5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBTeW5jSnNvblZhbHVlPn0gLSBBdHRyaWJ1dGVzLlxuICovXG5mdW5jdGlvbiBtdXRhdGlvbkF0dHJpYnV0ZXNGb3IobXV0YXRpb24pIHtcbiAgaWYgKCFtdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHR5cGVvZiBtdXRhdGlvbi5hdHRyaWJ1dGVzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobXV0YXRpb24uYXR0cmlidXRlcykpIHJldHVybiB7fVxuXG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFN5bmNKc29uVmFsdWU+fSAqLyAoSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShtdXRhdGlvbi5hdHRyaWJ1dGVzKSkpXG59XG5cbi8qKlxuICogQ29tcGFyZXMgSlNPTiB2YWx1ZXMgYnkgc3RhYmxlIHNlcmlhbGl6YXRpb24uXG4gKiBAcGFyYW0ge3Vua25vd259IGxlZnQgLSBMZWZ0IHZhbHVlLlxuICogQHBhcmFtIHt1bmtub3dufSByaWdodCAtIFJpZ2h0IHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgbWF0Y2guXG4gKi9cbmZ1bmN0aW9uIGpzb25WYWx1ZXNFcXVhbChsZWZ0LCByaWdodCkge1xuICByZXR1cm4gc3RhYmxlSnNvblN0cmluZ2lmeShsZWZ0KSA9PT0gc3RhYmxlSnNvblN0cmluZ2lmeShyaWdodClcbn1cblxuLyoqXG4gKiBTdGFibGUgSlNPTiBzdHJpbmdpZnkgaGVscGVyLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUgSlNPTi5cbiAqL1xuZnVuY3Rpb24gc3RhYmxlSnNvblN0cmluZ2lmeSh2YWx1ZSkge1xuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBgWyR7dmFsdWUubWFwKChlbnRyeSkgPT4gc3RhYmxlSnNvblN0cmluZ2lmeShlbnRyeSkpLmpvaW4oXCIsXCIpfV1gXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICByZXR1cm4gYHske09iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCkubWFwKChrZXkpID0+IGAke0pTT04uc3RyaW5naWZ5KGtleSl9OiR7c3RhYmxlSnNvblN0cmluZ2lmeSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpW2tleV0pfWApLmpvaW4oXCIsXCIpfX1gXG4gIH1cblxuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG59XG4iXX0=