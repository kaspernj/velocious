/**
 * Generic cursor-paginated change feed over an app-owned sync/change model.
 *
 * Apps provide the model and optional scoping/serialization hooks. Velocious owns
 * cursor parsing, snapshot high-water resolution, stable ordering, page limits,
 * and response shape for `/velocious/sync/changes` style endpoints.
 */
export default class SyncModelChangeFeedService {
    defaultLimit: number;
    maxLimit: number;
    modelClass: typeof import("../database/record/index.js").default;
    params: Record<string, unknown>;
    scopeQuery: ((args: {
        query: import("../database/query/model-class-query.js").default;
    }) => void) | null;
    serializeRecord: (record: ReturnType<typeof JSON.parse>) => Record<string, unknown>;
    /**
     * Creates a generic sync-model change-feed service.
     * @param {object} args - Service arguments.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Sync/change model class.
     * @param {Record<string, unknown>} args.params - Request params.
     * @param {number} [args.defaultLimit] - Default page size.
     * @param {number} [args.maxLimit] - Maximum page size.
     * @param {(record: ReturnType<typeof JSON.parse>) => Record<string, unknown>} [args.serializeRecord] - Record serializer.
     * @param {(args: {query: import("../database/query/model-class-query.js").default}) => void} [args.scopeQuery] - Applies app-owned visibility scope.
     */
    constructor({ defaultLimit, maxLimit, modelClass, params, scopeQuery, serializeRecord }: {
        modelClass: typeof import("../database/record/index.js").default;
        params: Record<string, unknown>;
        defaultLimit?: number;
        maxLimit?: number;
        serializeRecord?: (record: ReturnType<typeof JSON.parse>) => Record<string, unknown>;
        scopeQuery?: (args: {
            query: import("../database/query/model-class-query.js").default;
        }) => void;
    });
    /**
     * Builds a stable change-feed page. The additive `total` is the scope's pending
     * change count from the request cursor to the snapshot bound (a COUNT, not a
     * materialized read), so a client can render a "synced of total" progress bar;
     * older clients ignore it.
     * @returns {Promise<{status: string, nextCursor: {id: string, serverSequence: number, updatedAt: string} | null, syncs: Array<Record<string, unknown>>, total: number, upToCursor: {id: string, serverSequence: number, updatedAt: string} | null}>} Change-feed page result.
     */
    changes(): Promise<{
        status: string;
        nextCursor: {
            id: string;
            serverSequence: number;
            updatedAt: string;
        } | null;
        syncs: Array<Record<string, unknown>>;
        total: number;
        upToCursor: {
            id: string;
            serverSequence: number;
            updatedAt: string;
        } | null;
    }>;
    /**
     * Normalizes the requested page limit.
     * @param {unknown} value - Raw limit param.
     * @returns {number} Normalized page limit.
     */
    normalizedLimit(value: unknown): number;
    /**
     * Parses an optional positive integer cursor field.
     * @param {unknown} value - Raw integer param.
     * @param {string} name - Param name for error messages.
     * @returns {number | null} Positive integer value, or null when omitted.
     */
    optionalPositiveIntegerParam(value: unknown, name: string): number | null;
    /**
     * Resolves the high-water cursor that bounds the current feed page.
     * @returns {Promise<{id: string, serverSequence: number, updatedAt: string} | null>} Snapshot upper-bound cursor.
     */
    resolveUpToCursor(): Promise<{
        id: string;
        serverSequence: number;
        updatedAt: string;
    } | null>;
    /**
     * Builds the ordered and cursor-filtered page query.
     * @param {{limit: number, upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Page query args.
     * @returns {import("../database/query/model-class-query.js").default} Page query.
     */
    pageQuery({ limit, upToCursor }: {
        limit: number;
        upToCursor: {
            id: string;
            serverSequence: number;
            updatedAt: string;
        };
    }): import("../database/query/model-class-query.js").default;
    /**
     * Counts the scope's pending change rows from the request cursor to the snapshot
     * bound without materializing them, so the client can render a stable "of Y"
     * progress denominator.
     * @param {{upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Count args.
     * @returns {Promise<number>} Pending change count from the request cursor.
     */
    totalPendingChanges({ upToCursor }: {
        upToCursor: {
            id: string;
            serverSequence: number;
            updatedAt: string;
        };
    }): Promise<number>;
    /**
     * Builds a scoped query with the snapshot upper bound and after-cursor filters
     * applied, but without ordering or a page limit. Shared by the page read and the
     * total-count so both count the same set of rows.
     * @param {{upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Filter args.
     * @returns {import("../database/query/model-class-query.js").default} Cursor-filtered query.
     */
    cursorFilteredQuery({ upToCursor }: {
        upToCursor: {
            id: string;
            serverSequence: number;
            updatedAt: string;
        };
    }): import("../database/query/model-class-query.js").default;
    /**
     * Builds a base query with app-owned scope applied.
     * @returns {import("../database/query/model-class-query.js").default} Scoped base query.
     */
    scopedQuery(): import("../database/query/model-class-query.js").default;
    /**
     * Serializes a record into a transport cursor.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @returns {{id: string, serverSequence: number, updatedAt: string}} Cursor for row.
     */
    cursorForRecord(record: ReturnType<typeof JSON.parse>): {
        id: string;
        serverSequence: number;
        updatedAt: string;
    };
    /**
     * Serializes a record using the standard sync envelope shape plus the sync
     * model's declared scope-partition attributes (`static syncScopeAttributes`),
     * each emitted under its own attribute name. Models declaring no scope
     * attributes keep the deprecated 1.0.503 wire and emit `eventId`. Keys are
     * sorted so a declared `["eventId"]` partition stays byte-identical with the
     * 1.0.503 wire.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @returns {Record<string, unknown>} Default serialized row.
     */
    defaultSerializeRecord(record: ReturnType<typeof JSON.parse>): Record<string, unknown>;
    /**
     * Reads and parses the record data payload.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @returns {unknown} Parsed data value.
     */
    recordData(record: ReturnType<typeof JSON.parse>): unknown;
    /**
     * Reads a value from either a record accessor method or plain property.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @param {string} name - Camel-cased value/method name.
     * @returns {unknown} Record value.
     */
    recordValue(record: ReturnType<typeof JSON.parse>, name: string): unknown;
    /**
     * Converts a date-like value to an ISO string.
     * @param {Date | string | null | undefined | unknown} value - Date value.
     * @returns {string} ISO date.
     */
    isoDate(value: Date | string | null | undefined | unknown): string;
}
//# sourceMappingURL=sync-model-change-feed-service.d.ts.map