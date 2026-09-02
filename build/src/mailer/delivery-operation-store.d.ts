import BackgroundJobsStore from "../background-jobs/store.js";
/**
 * Durable first-attempt and retention guard for required mail operations.
 */
export default class MailerDeliveryOperationStore {
    backgroundJobsStore: BackgroundJobsStore;
    clock: () => number;
    configuration: import("../configuration.js").default;
    /**
     * Creates a durable mail-operation state guard.
     * @param {object} args - Store input.
     * @param {import("../configuration.js").default} args.configuration - Active configuration.
     * @param {() => number} [args.clock] - Explicit clock dependency.
     */
    constructor({ configuration, clock }: {
        configuration: import("../configuration.js").default;
        clock?: () => number;
    });
    /**
     * Atomically starts the provider retention clock once and rejects expired attempts.
     * @param {object} args - Attempt input.
     * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Current backend capability.
     * @param {import("./index.js").MailerDeliveryPayload} args.payload - Persisted payload.
     * @returns {Promise<{expiresAtMs: number, firstAttemptStartedAtMs: number}>} - Attempt window.
     */
    beginAttempt({ capability, payload }: {
        capability: import("./index.js").MailerDeliveryIdempotencyCapability;
        payload: import("./index.js").MailerDeliveryPayload;
    }): Promise<{
        expiresAtMs: number;
        firstAttemptStartedAtMs: number;
    }>;
    /**
     * Loads one operation by its fixed-size digest key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} operationId - Operation id.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
     */
    _operationRow(db: import("../database/drivers/base.js").default, operationId: string): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Validates immutable durable fields without including mail content in failures.
     * @param {object} args - Validation input.
     * @param {import("./index.js").MailerDeliveryOperation} args.operation - Persisted payload operation.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Durable operation row.
     * @returns {void}
     */
    _validateRow({ operation, row }: {
        operation: import("./index.js").MailerDeliveryOperation;
        row: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
}
//# sourceMappingURL=delivery-operation-store.d.ts.map