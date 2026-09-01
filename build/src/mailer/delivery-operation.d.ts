export declare const MAIL_DELIVERY_JOB_NAME = "MailDeliveryJob";
export declare const MAIL_DELIVERY_OPERATIONS_TABLE = "mailer_delivery_operations";
/**
 * Reads and validates a backend's provider idempotency capability.
 * @param {object} args - Capability input.
 * @param {import("../configuration-types.js").MailerBackend | undefined} args.backend - Configured backend.
 * @param {import("./index.js").MailerDeliveryOperationRequest | import("./index.js").MailerDeliveryOperation} args.deliveryOperation - Required operation.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Rendered or persisted payload.
 * @returns {import("./index.js").MailerDeliveryIdempotencyCapability} - Capability.
 */
export declare function requireDeliveryIdempotencyCapability({ backend, deliveryOperation, payload }: {
    backend: import("../configuration-types.js").MailerBackend | undefined;
    deliveryOperation: import("./index.js").MailerDeliveryOperationRequest | import("./index.js").MailerDeliveryOperation;
    payload: import("./index.js").MailerDeliveryPayload;
}): import("./index.js").MailerDeliveryIdempotencyCapability;
/**
 * Normalizes one public required operation into immutable payload metadata.
 * @param {object} args - Preparation input.
 * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Backend capability.
 * @param {import("./index.js").MailerDeliveryOperationRequest} args.deliveryOperation - Public operation request.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Rendered payload.
 * @returns {import("./index.js").MailerDeliveryPayload} - Payload with immutable operation metadata.
 */
export declare function prepareRequiredDeliveryPayload({ capability, deliveryOperation, payload }: {
    capability: import("./index.js").MailerDeliveryIdempotencyCapability;
    deliveryOperation: import("./index.js").MailerDeliveryOperationRequest;
    payload: import("./index.js").MailerDeliveryPayload;
}): import("./index.js").MailerDeliveryPayload;
/**
 * Builds the versioned digest for every recipient-visible/provider-relevant payload field.
 * @param {object} args - Digest input.
 * @param {string} args.operationId - Stable operation id.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Rendered payload.
 * @returns {string} - Versioned SHA-256 digest.
 */
export declare function mailDeliveryPayloadDigest({ operationId, payload }: {
    operationId: string;
    payload: import("./index.js").MailerDeliveryPayload;
}): string;
/**
 * Extracts validated persisted operation metadata from a payload.
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail payload.
 * @returns {import("./index.js").MailerDeliveryOperation | null} - Operation or null.
 */
export declare function deliveryOperationFromPayload(payload: import("./index.js").MailerDeliveryPayload): import("./index.js").MailerDeliveryOperation | null;
/**
 * Extracts a built-in mail operation from generic job arguments.
 * @param {string} jobName - Job class name.
 * @param {Array<ReturnType<typeof JSON.parse>>} args - Job arguments.
 * @returns {{operation: import("./index.js").MailerDeliveryOperation, payload: import("./index.js").MailerDeliveryPayload} | null} - Mail operation input.
 */
export declare function mailDeliveryOperationForJob(jobName: string, args: Array<ReturnType<typeof JSON.parse>>): {
    operation: import("./index.js").MailerDeliveryOperation;
    payload: import("./index.js").MailerDeliveryPayload;
} | null;
/**
 * Fixed-size primary key for a potentially long operation id.
 * @param {string} operationId - Operation id.
 * @returns {string} - SHA-256 operation key.
 */
export declare function mailDeliveryOperationKey(operationId: string): string;
/**
 * Validates provider compatibility and payload integrity before an attempt.
 * @param {object} args - Validation input.
 * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Current backend capability.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Persisted payload.
 * @returns {import("./index.js").MailerDeliveryOperation} - Persisted operation.
 */
export declare function validateAttemptPayload({ capability, payload }: {
    capability: import("./index.js").MailerDeliveryIdempotencyCapability;
    payload: import("./index.js").MailerDeliveryPayload;
}): import("./index.js").MailerDeliveryOperation;
//# sourceMappingURL=delivery-operation.d.ts.map