import SmtpMailerBackend from "./smtp.js";
/**
 * Resend SMTP transport with Resend's documented 24-hour idempotency header.
 */
export default class ResendSmtpMailerBackend extends SmtpMailerBackend {
    /**
     * Resolves the SMTP sender before it becomes part of the immutable digest.
     * @param {object} args - Preparation input.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered payload.
     * @returns {import("../index.js").MailerDeliveryPayload} - Provider-ready payload.
     */
    prepareDeliveryOperationPayload({ payload }: {
        payload: import("../index.js").MailerDeliveryPayload;
    }): import("../index.js").MailerDeliveryPayload;
    /**
     * Advertises the provider-specific guarantee used by required operations.
     * @returns {import("../index.js").MailerDeliveryIdempotencyCapability} - Capability.
     */
    deliveryIdempotencyCapability(): import("../index.js").MailerDeliveryIdempotencyCapability;
    /**
     * Validates Resend's documented length and SMTP header-value safety contract.
     * @param {object} args - Validation input.
     * @param {import("../index.js").MailerDeliveryOperationRequest | import("../index.js").MailerDeliveryOperation} args.deliveryOperation - Operation.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered or persisted mail payload.
     * @returns {void}
     */
    validateDeliveryOperation({ deliveryOperation, payload }: {
        deliveryOperation: import("../index.js").MailerDeliveryOperationRequest | import("../index.js").MailerDeliveryOperation;
        payload: import("../index.js").MailerDeliveryPayload;
    }): void;
    /**
     * Injects the framework-owned Resend operation header before generic SMTP serialization.
     * @param {object} args - Delivery args.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Mail payload.
     * @param {import("../../configuration.js").default} [args.configuration] - Active configuration.
     * @returns {Promise<void>} - Resolves when accepted and shut down.
     */
    deliver({ payload, configuration }: {
        payload: import("../index.js").MailerDeliveryPayload;
        configuration?: import("../../configuration.js").default;
    }): Promise<void>;
}
//# sourceMappingURL=resend-smtp.d.ts.map