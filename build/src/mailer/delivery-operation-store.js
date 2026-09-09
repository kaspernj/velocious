// @ts-check
import BackgroundJobsStore from "../background-jobs/store.js";
import VelociousError from "../velocious-error.js";
import { MAIL_DELIVERY_OPERATIONS_TABLE, mailDeliveryOperationKey, validateAttemptPayload } from "./delivery-operation.js";
/**
 * Durable first-attempt and retention guard for required mail operations.
 */
export default class MailerDeliveryOperationStore {
    /**
     * Creates a durable mail-operation state guard.
     * @param {object} args - Store input.
     * @param {import("../configuration.js").default} args.configuration - Active configuration.
     * @param {() => number} [args.clock] - Explicit clock dependency.
     */
    constructor({ configuration, clock = () => Date.now() }) {
        this.backgroundJobsStore = new BackgroundJobsStore({ configuration });
        this.clock = clock;
        this.configuration = configuration;
    }
    /**
     * Atomically starts the provider retention clock once and rejects expired attempts.
     * @param {object} args - Attempt input.
     * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Current backend capability.
     * @param {import("./index.js").MailerDeliveryPayload} args.payload - Persisted payload.
     * @returns {Promise<{expiresAtMs: number, firstAttemptStartedAtMs: number}>} - Attempt window.
     */
    async beginAttempt({ capability, payload }) {
        const operation = validateAttemptPayload({ capability, payload });
        const nowMs = this.clock();
        if (!Number.isSafeInteger(nowMs) || nowMs < 0)
            throw new Error("Mailer delivery operation clock must return a non-negative safe integer");
        const databaseIdentifier = this.backgroundJobsStore.getDatabaseIdentifier();
        return await this.configuration.ensureConnections({
            databaseIdentifiers: [databaseIdentifier],
            name: "Mailer delivery operation attempt"
        }, async (dbs) => {
            const db = dbs[databaseIdentifier];
            if (db.insideTransaction()) {
                throw VelociousError.safe("Required mail delivery cannot start inside an existing database transaction.", {
                    code: "mail-delivery-idempotency-transaction-active"
                });
            }
            await this.backgroundJobsStore.ensureSchema(db);
            return await db.transaction(async () => {
                const operationKey = mailDeliveryOperationKey(operation.id);
                // A value-preserving structured update obtains the row's write lock on
                // every driver before we inspect or initialize the one-shot timestamp.
                await db.update({
                    tableName: MAIL_DELIVERY_OPERATIONS_TABLE,
                    data: { operation_key: operationKey },
                    conditions: { operation_key: operationKey }
                });
                let row = await this._operationRow(db, operation.id);
                if (!row)
                    throw new Error("Required mail delivery operation is not durably registered");
                this._validateRow({ operation, row });
                let firstAttemptStartedAtMs = numberOrNull(row.first_attempt_started_at_ms);
                if (firstAttemptStartedAtMs === null) {
                    await db.update({
                        tableName: MAIL_DELIVERY_OPERATIONS_TABLE,
                        data: { first_attempt_started_at_ms: nowMs },
                        conditions: { operation_key: operationKey }
                    });
                    row = await this._operationRow(db, operation.id);
                    firstAttemptStartedAtMs = row ? numberOrNull(row.first_attempt_started_at_ms) : null;
                    if (firstAttemptStartedAtMs === null)
                        throw new Error("Failed to durably start mail delivery provider retention");
                }
                const expiresAtMs = firstAttemptStartedAtMs + operation.providerRetentionMs;
                if (nowMs >= expiresAtMs) {
                    throw VelociousError.safe("The required mail delivery idempotency window expired before another attempt.", {
                        code: "mail-delivery-idempotency-expired",
                        details: {
                            expiresAtMs,
                            firstAttemptStartedAtMs,
                            operationId: operation.id,
                            providerKind: operation.providerKind
                        }
                    });
                }
                return { expiresAtMs, firstAttemptStartedAtMs };
            });
        });
    }
    /**
     * Loads one operation by its fixed-size digest key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} operationId - Operation id.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
     */
    async _operationRow(db, operationId) {
        const rows = await db
            .newQuery()
            .from(MAIL_DELIVERY_OPERATIONS_TABLE)
            .where({ operation_key: mailDeliveryOperationKey(operationId) })
            .limit(1)
            .results();
        return rows[0] ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0]) : null;
    }
    /**
     * Validates immutable durable fields without including mail content in failures.
     * @param {object} args - Validation input.
     * @param {import("./index.js").MailerDeliveryOperation} args.operation - Persisted payload operation.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Durable operation row.
     * @returns {void}
     */
    _validateRow({ operation, row }) {
        const matches = String(row.operation_id) === operation.id
            && String(row.payload_digest) === operation.payloadDigest
            && String(row.provider_kind) === operation.providerKind
            && numberOrNull(row.provider_retention_ms) === operation.providerRetentionMs;
        if (!matches) {
            throw VelociousError.safe("The durable mail delivery operation does not match the persisted payload or provider.", {
                code: "mail-delivery-idempotency-conflict"
            });
        }
    }
}
/**
 * Normalizes a database integer.
 * @param {ReturnType<typeof JSON.parse>} value - Database value.
 * @returns {number | null} - Number or null.
 */
function numberOrNull(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const number = Number(value);
    return Number.isNaN(number) ? null : number;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsaXZlcnktb3BlcmF0aW9uLXN0b3JlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL21haWxlci9kZWxpdmVyeS1vcGVyYXRpb24tc3RvcmUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sbUJBQW1CLE1BQU0sNkJBQTZCLENBQUE7QUFDN0QsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxFQUNMLDhCQUE4QixFQUM5Qix3QkFBd0IsRUFDeEIsc0JBQXNCLEVBQ3ZCLE1BQU0seUJBQXlCLENBQUE7QUFFaEM7O0dBRUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDRCQUE0QjtJQUMvQzs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsS0FBSyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBQztRQUNuRCxJQUFJLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxtQkFBbUIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDbkUsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ3RDLE1BQU0sU0FBUyxHQUFHLHNCQUFzQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDL0QsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBRTFCLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5RUFBeUUsQ0FBQyxDQUFBO1FBRXpJLE1BQU0sa0JBQWtCLEdBQUcsSUFB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QUFLLEtBQUssU0FBUyxJQUFJLEtBQUssS0FBSyxFQUFFO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFDdEUsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBRTVCLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUE7QUFDN0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdG9yZSBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCB7XG4gIE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSxcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5LFxuICB2YWxpZGF0ZUF0dGVtcHRQYXlsb2FkXG59IGZyb20gXCIuL2RlbGl2ZXJ5LW9wZXJhdGlvbi5qc1wiXG5cbi8qKlxuICogRHVyYWJsZSBmaXJzdC1hdHRlbXB0IGFuZCByZXRlbnRpb24gZ3VhcmQgZm9yIHJlcXVpcmVkIG1haWwgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWFpbGVyRGVsaXZlcnlPcGVyYXRpb25TdG9yZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZHVyYWJsZSBtYWlsLW9wZXJhdGlvbiBzdGF0ZSBndWFyZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTdG9yZSBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIEFjdGl2ZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IG51bWJlcn0gW2FyZ3MuY2xvY2tdIC0gRXhwbGljaXQgY2xvY2sgZGVwZW5kZW5jeS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjbG9jayA9ICgpID0+IERhdGUubm93KCl9KSB7XG4gICAgdGhpcy5iYWNrZ3JvdW5kSm9ic1N0b3JlID0gbmV3IEJhY2tncm91bmRKb2JzU3RvcmUoe2NvbmZpZ3VyYXRpb259KVxuICAgIHRoaXMuY2xvY2sgPSBjbG9ja1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHN0YXJ0cyB0aGUgcHJvdmlkZXIgcmV0ZW50aW9uIGNsb2NrIG9uY2UgYW5kIHJlamVjdHMgZXhwaXJlZCBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBdHRlbXB0IGlucHV0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlJZGVtcG90ZW5jeUNhcGFiaWxpdHl9IGFyZ3MuY2FwYWJpbGl0eSAtIEN1cnJlbnQgYmFja2VuZCBjYXBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSBhcmdzLnBheWxvYWQgLSBQZXJzaXN0ZWQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2V4cGlyZXNBdE1zOiBudW1iZXIsIGZpcnN0QXR0ZW1wdFN0YXJ0ZWRBdE1zOiBudW1iZXJ9Pn0gLSBBdHRlbXB0IHdpbmRvdy5cbiAgICovXG4gIGFzeW5jIGJlZ2luQXR0ZW1wdCh7Y2FwYWJpbGl0eSwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCBvcGVyYXRpb24gPSB2YWxpZGF0ZUF0dGVtcHRQYXlsb2FkKHtjYXBhYmlsaXR5LCBwYXlsb2FkfSlcbiAgICBjb25zdCBub3dNcyA9IHRoaXMuY2xvY2soKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihub3dNcykgfHwgbm93TXMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoXCJNYWlsZXIgZGVsaXZlcnkgb3BlcmF0aW9uIGNsb2NrIG11c3QgcmV0dXJuIGEgbm9uLW5lZ2F0aXZlIHNhZmUgaW50ZWdlclwiKVxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5iYWNrZ3JvdW5kSm9ic1N0b3JlLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnM6IFtkYXRhYmFzZUlkZW50aWZpZXJdLFxuICAgICAgbmFtZTogXCJNYWlsZXIgZGVsaXZlcnkgb3BlcmF0aW9uIGF0dGVtcHRcIlxuICAgIH0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW2RhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgaWYgKGRiLmluc2lkZVRyYW5zYWN0aW9uKCkpIHtcbiAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlJlcXVpcmVkIG1haWwgZGVsaXZlcnkgY2Fubm90IHN0YXJ0IGluc2lkZSBhbiBleGlzdGluZyBkYXRhYmFzZSB0cmFuc2FjdGlvbi5cIiwge1xuICAgICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS10cmFuc2FjdGlvbi1hY3RpdmVcIlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmJhY2tncm91bmRKb2JzU3RvcmUuZW5zdXJlU2NoZW1hKGRiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBvcGVyYXRpb25LZXkgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKVxuXG4gICAgICAgIC8vIEEgdmFsdWUtcHJlc2VydmluZyBzdHJ1Y3R1cmVkIHVwZGF0ZSBvYnRhaW5zIHRoZSByb3cncyB3cml0ZSBsb2NrIG9uXG4gICAgICAgIC8vIGV2ZXJ5IGRyaXZlciBiZWZvcmUgd2UgaW5zcGVjdCBvciBpbml0aWFsaXplIHRoZSBvbmUtc2hvdCB0aW1lc3RhbXAuXG4gICAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgICAgdGFibGVOYW1lOiBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX0sXG4gICAgICAgICAgY29uZGl0aW9uczoge29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX1cbiAgICAgICAgfSlcbiAgICAgICAgbGV0IHJvdyA9IGF3YWl0IHRoaXMuX29wZXJhdGlvblJvdyhkYiwgb3BlcmF0aW9uLmlkKVxuXG4gICAgICAgIGlmICghcm93KSB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiBpcyBub3QgZHVyYWJseSByZWdpc3RlcmVkXCIpXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlUm93KHtvcGVyYXRpb24sIHJvd30pXG5cbiAgICAgICAgbGV0IGZpcnN0QXR0ZW1wdFN0YXJ0ZWRBdE1zID0gbnVtYmVyT3JOdWxsKHJvdy5maXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXMpXG5cbiAgICAgICAgaWYgKGZpcnN0QXR0ZW1wdFN0YXJ0ZWRBdE1zID09PSBudWxsKSB7XG4gICAgICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgICAgIHRhYmxlTmFtZTogTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLFxuICAgICAgICAgICAgZGF0YToge2ZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tczogbm93TXN9LFxuICAgICAgICAgICAgY29uZGl0aW9uczoge29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX1cbiAgICAgICAgICB9KVxuICAgICAgICAgIHJvdyA9IGF3YWl0IHRoaXMuX29wZXJhdGlvblJvdyhkYiwgb3BlcmF0aW9uLmlkKVxuICAgICAgICAgIGZpcnN0QXR0ZW1wdFN0YXJ0ZWRBdE1zID0gcm93ID8gbnVtYmVyT3JOdWxsKHJvdy5maXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXMpIDogbnVsbFxuXG4gICAgICAgICAgaWYgKGZpcnN0QXR0ZW1wdFN0YXJ0ZWRBdE1zID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gZHVyYWJseSBzdGFydCBtYWlsIGRlbGl2ZXJ5IHByb3ZpZGVyIHJldGVudGlvblwiKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhwaXJlc0F0TXMgPSBmaXJzdEF0dGVtcHRTdGFydGVkQXRNcyArIG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG5cbiAgICAgICAgaWYgKG5vd01zID49IGV4cGlyZXNBdE1zKSB7XG4gICAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSByZXF1aXJlZCBtYWlsIGRlbGl2ZXJ5IGlkZW1wb3RlbmN5IHdpbmRvdyBleHBpcmVkIGJlZm9yZSBhbm90aGVyIGF0dGVtcHQuXCIsIHtcbiAgICAgICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1leHBpcmVkXCIsXG4gICAgICAgICAgICBkZXRhaWxzOiB7XG4gICAgICAgICAgICAgIGV4cGlyZXNBdE1zLFxuICAgICAgICAgICAgICBmaXJzdEF0dGVtcHRTdGFydGVkQXRNcyxcbiAgICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgICAgICAgICAgcHJvdmlkZXJLaW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7ZXhwaXJlc0F0TXMsIGZpcnN0QXR0ZW1wdFN0YXJ0ZWRBdE1zfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG9uZSBvcGVyYXRpb24gYnkgaXRzIGZpeGVkLXNpemUgZGlnZXN0IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uSWQgLSBPcGVyYXRpb24gaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX29wZXJhdGlvblJvdyhkYiwgb3BlcmF0aW9uSWQpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe29wZXJhdGlvbl9rZXk6IG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb25JZCl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGltbXV0YWJsZSBkdXJhYmxlIGZpZWxkcyB3aXRob3V0IGluY2x1ZGluZyBtYWlsIGNvbnRlbnQgaW4gZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9ufSBhcmdzLm9wZXJhdGlvbiAtIFBlcnNpc3RlZCBwYXlsb2FkIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mucm93IC0gRHVyYWJsZSBvcGVyYXRpb24gcm93LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJvdyh7b3BlcmF0aW9uLCByb3d9KSB7XG4gICAgY29uc3QgbWF0Y2hlcyA9IFN0cmluZyhyb3cub3BlcmF0aW9uX2lkKSA9PT0gb3BlcmF0aW9uLmlkXG4gICAgICAmJiBTdHJpbmcocm93LnBheWxvYWRfZGlnZXN0KSA9PT0gb3BlcmF0aW9uLnBheWxvYWREaWdlc3RcbiAgICAgICYmIFN0cmluZyhyb3cucHJvdmlkZXJfa2luZCkgPT09IG9wZXJhdGlvbi5wcm92aWRlcktpbmRcbiAgICAgICYmIG51bWJlck9yTnVsbChyb3cucHJvdmlkZXJfcmV0ZW50aW9uX21zKSA9PT0gb3BlcmF0aW9uLnByb3ZpZGVyUmV0ZW50aW9uTXNcblxuICAgIGlmICghbWF0Y2hlcykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBkdXJhYmxlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIGRvZXMgbm90IG1hdGNoIHRoZSBwZXJzaXN0ZWQgcGF5bG9hZCBvciBwcm92aWRlci5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgZGF0YWJhc2UgaW50ZWdlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gRGF0YWJhc2UgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOdW1iZXIgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gbnVtYmVyT3JOdWxsKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSByZXR1cm4gbnVsbFxuICBjb25zdCBudW1iZXIgPSBOdW1iZXIodmFsdWUpXG5cbiAgcmV0dXJuIE51bWJlci5pc05hTihudW1iZXIpID8gbnVsbCA6IG51bWJlclxufVxuIl19